-- Step 3.2 (1 of 3): workspaces, members and the membership helpers.
-- docs/plan.md §4.1–4.3. Nothing existing changes in this file.

create type public.workspace_role as enum ('viewer', 'member', 'owner');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz -- soft delete (D-17); set only by a definer function (3.5)
);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- Helpers ---------------------------------------------------------------------

create function public.role_rank(r public.workspace_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case r when 'viewer' then 1 when 'member' then 2 when 'owner' then 3 end;
$$;

-- The caller's workspaces where they hold at least p_min_role. security
-- definer: it reads workspace_members without RLS, so policies that call it
-- never recurse into workspace_members' own policies (plan §4.2). Policies use
-- it as `workspace_id in (select public.my_workspaces(...))`, which Postgres
-- evaluates once per statement, not once per row.
create function public.my_workspaces(p_min_role public.workspace_role)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
   where m.user_id = (select auth.uid())
     and w.deleted_at is null
     and public.role_rank(m.role) >= public.role_rank(p_min_role);
$$;

create function public.is_member(p_workspace_id uuid, p_min_role public.workspace_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.my_workspaces(p_min_role) w where w = p_workspace_id
  );
$$;

-- Users who share at least one workspace with the caller (for profile names).
create function public.my_coworkers()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct other.user_id
    from public.workspace_members mine
    join public.workspace_members other on other.workspace_id = mine.workspace_id
    join public.workspaces w on w.id = mine.workspace_id
   where mine.user_id = (select auth.uid())
     and w.deleted_at is null;
$$;

-- Creates a workspace with the caller as its owner. The only insert path for
-- workspaces from a client (plan §4.3).
create function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.workspaces (name, created_by) values (p_name, uid) returning id into new_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (new_id, uid, 'owner');
  return new_id;
end;
$$;

-- A workspace always keeps an owner. Enforced for changes made by users; a
-- cascade from deleting an account or workspace (no auth.uid()) is allowed.
create function public.workspace_members_keep_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role is distinct from 'owner')
     and not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = old.workspace_id
          and m.role = 'owner'
          and m.user_id <> old.user_id
     ) then
    raise exception 'a workspace needs at least one owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger workspace_members_keep_owner
  before update or delete on public.workspace_members
  for each row execute function public.workspace_members_keep_owner();

revoke execute on function public.my_workspaces(public.workspace_role) from public, anon;
revoke execute on function public.is_member(uuid, public.workspace_role) from public, anon;
revoke execute on function public.my_coworkers() from public, anon;
revoke execute on function public.create_workspace(text) from public, anon;
revoke execute on function public.workspace_members_keep_owner() from public, anon, authenticated;
grant execute on function public.my_workspaces(public.workspace_role) to authenticated;
grant execute on function public.is_member(uuid, public.workspace_role) to authenticated;
grant execute on function public.my_coworkers() to authenticated;
grant execute on function public.create_workspace(text) to authenticated;

-- Grants and policies -----------------------------------------------------------

revoke all on public.workspaces from anon, authenticated;
grant select on public.workspaces to authenticated;
grant update (name) on public.workspaces to authenticated;

create policy "workspaces: select as member"
  on public.workspaces for select
  to authenticated
  using (id in (select public.my_workspaces('viewer')));

create policy "workspaces: update as owner"
  on public.workspaces for update
  to authenticated
  using (id in (select public.my_workspaces('owner')))
  with check (id in (select public.my_workspaces('owner')));

revoke all on public.workspace_members from anon, authenticated;
grant select, delete on public.workspace_members to authenticated;
grant update (role) on public.workspace_members to authenticated;

create policy "workspace_members: select in my workspaces"
  on public.workspace_members for select
  to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));

create policy "workspace_members: update as owner"
  on public.workspace_members for update
  to authenticated
  using (workspace_id in (select public.my_workspaces('owner')))
  with check (workspace_id in (select public.my_workspaces('owner')));

-- Owners remove members (aal2 is added at 3.5); anyone may leave.
create policy "workspace_members: delete as owner or self"
  on public.workspace_members for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or workspace_id in (select public.my_workspaces('owner'))
  );

-- Co-members can read each other's profile (names for assignees and members).
create policy "profiles: select coworkers"
  on public.profiles for select
  to authenticated
  using (id in (select public.my_coworkers()));
