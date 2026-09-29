-- Step 1.6: projects, owned by one user in Phase 1 (docs/plan.md §2.1, §2.2, D-1, D-3).

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target for the composite FK from tasks (step 1.7), so a task can only
  -- point at a project with the same owner.
  unique (id, owner_id)
);

-- No duplicate names per user, case-insensitive, archived projects included.
create unique index projects_owner_id_lower_name_key on public.projects (owner_id, lower(name));

alter table public.projects enable row level security;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Privileges: clients set only name (and archived_at on update). owner_id
-- comes from auth.uid(); ids and timestamps are not writable.
revoke all on public.projects from anon, authenticated;
grant select, delete on public.projects to authenticated;
grant insert (name) on public.projects to authenticated;
grant update (name, archived_at) on public.projects to authenticated;

create policy "projects: select own"
  on public.projects for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "projects: insert own"
  on public.projects for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "projects: update own"
  on public.projects for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "projects: delete own"
  on public.projects for delete
  to authenticated
  using (owner_id = (select auth.uid()));
