-- Step 3.3: invite a user to a workspace by email (docs/plan.md §4.6, D-16, D-18).
-- The owner gets a link once; only the token's SHA-256 is stored. Accepting
-- checks: the token matches, it's not expired or used, and the signed-in
-- user's email is the invited one.

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+$'),
  -- Owners are promoted by an owner, not invited.
  role public.workspace_role not null check (role in ('member', 'viewer')),
  token_hash bytea not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null
);

-- One open invite per email per workspace; a new one replaces it.
create unique index invites_open_email_key on public.invites (workspace_id, email)
  where accepted_at is null;

alter table public.invites enable row level security;

-- Owners see and revoke their workspace's invites. Creating and accepting go
-- through the functions below; there is no direct insert or update.
revoke all on public.invites from anon, authenticated;
grant select (id, workspace_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_by)
  on public.invites to authenticated;
grant delete on public.invites to authenticated;

create policy "invites: select as owner"
  on public.invites for select to authenticated
  using (workspace_id in (select public.my_workspaces('owner')));

create policy "invites: delete as owner"
  on public.invites for delete to authenticated
  using (workspace_id in (select public.my_workspaces('owner')));

-- Returns the token once. Only its hash is stored, so a leaked database row
-- can't be turned into a working link.
create function public.create_invite(
  p_workspace_id uuid,
  p_email text,
  p_role public.workspace_role
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  email_norm text := lower(btrim(p_email));
begin
  if not public.is_member(p_workspace_id, 'owner') then
    raise exception 'only an owner can invite' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.workspace_members m
      join auth.users u on u.id = m.user_id
     where m.workspace_id = p_workspace_id and lower(u.email) = email_norm
  ) then
    raise exception 'invite_already_member' using errcode = 'P0001';
  end if;

  delete from public.invites
   where workspace_id = p_workspace_id and email = email_norm and accepted_at is null;
  insert into public.invites (workspace_id, email, role, token_hash, invited_by)
  values (p_workspace_id, email_norm, p_role, sha256(convert_to(token, 'UTF8')), auth.uid());
  return token;
end;
$$;

-- What the invite page shows before accepting. Reveals the workspace name and
-- role only to the invited email; anyone else learns just that it isn't for them.
create function public.invite_preview(p_token text)
returns table (status text, workspace_name text, role public.workspace_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inv public.invites;
begin
  select * into inv from public.invites where token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found then
    return query select 'invalid'::text, null::text, null::public.workspace_role;
  elsif inv.email <> lower((select auth.jwt() ->> 'email')) then
    return query select 'wrong_email'::text, null::text, null::public.workspace_role;
  elsif inv.accepted_at is not null then
    return query select 'used'::text, null::text, null::public.workspace_role;
  elsif inv.expires_at <= now() then
    return query select 'expired'::text, null::text, null::public.workspace_role;
  else
    return query
      select 'ok'::text, w.name, inv.role from public.workspaces w
       where w.id = inv.workspace_id and w.deleted_at is null;
    if not found then
      return query select 'invalid'::text, null::text, null::public.workspace_role;
    end if;
  end if;
end;
$$;

-- Accepts an invite for the signed-in user and returns the workspace id.
-- Single use: the row is locked, so two concurrent accepts can't both succeed.
create function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.invites;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into inv from public.invites
   where token_hash = sha256(convert_to(p_token, 'UTF8'))
   for update;
  if not found then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if inv.email <> lower((select auth.jwt() ->> 'email')) then
    raise exception 'invite_wrong_email' using errcode = 'P0001';
  end if;
  if inv.accepted_at is not null then
    raise exception 'invite_used' using errcode = 'P0001';
  end if;
  if inv.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.workspaces where id = inv.workspace_id and deleted_at is null) then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, uid, inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.invites set accepted_at = now(), accepted_by = uid where id = inv.id;
  return inv.workspace_id;
end;
$$;

revoke execute on function public.create_invite(uuid, text, public.workspace_role) from public, anon;
revoke execute on function public.invite_preview(text) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.create_invite(uuid, text, public.workspace_role) to authenticated;
grant execute on function public.invite_preview(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
