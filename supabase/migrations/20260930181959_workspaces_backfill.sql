-- Step 3.2 (2 of 3): move every project, task and usage row into a Personal
-- workspace per user, and switch projects and tasks from "own rows" to
-- membership policies. docs/plan.md §4.4. The file runs as one transaction and
-- checks its own result at the end: any mismatch aborts all of it.
--
-- owner_id stays on projects and tasks (it now means "created by"), so a
-- rollback only needs to restore the old policies (plan §4.4, Rollback).

-- 1. Counts before --------------------------------------------------------------

create temporary table _before on commit drop as
select
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.projects) as projects,
  (select count(*) from public.tasks) as tasks,
  (select count(*) from public.tasks where series_id is not null) as series_rows,
  (select count(*) from public.llm_usage) as llm_usage;

create temporary table _before_per_owner on commit drop as
select owner_id, 'projects' as kind, count(*) as n from public.projects group by owner_id
union all
select owner_id, 'tasks', count(*) from public.tasks group by owner_id;

-- 2. One Personal workspace per user, with that user as owner --------------------

create temporary table _personal on commit drop as
select p.id as user_id, gen_random_uuid() as workspace_id from public.profiles p;

insert into public.workspaces (id, name, created_by)
select workspace_id, 'Personal', user_id from _personal;

insert into public.workspace_members (workspace_id, user_id, role)
select workspace_id, user_id, 'owner' from _personal;

-- 3. workspace_id on projects, tasks and llm_usage ------------------------------

alter table public.projects
  add column workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.tasks
  add column workspace_id uuid references public.workspaces (id) on delete cascade,
  add column assignee_id uuid references public.profiles (id) on delete set null;
alter table public.llm_usage
  add column workspace_id uuid references public.workspaces (id) on delete set null;

update public.projects t set workspace_id = m.workspace_id from _personal m where m.user_id = t.owner_id;
update public.tasks t set workspace_id = m.workspace_id from _personal m where m.user_id = t.owner_id;
update public.llm_usage t set workspace_id = m.workspace_id from _personal m where m.user_id = t.user_id;

alter table public.projects alter column workspace_id set not null;
alter table public.tasks alter column workspace_id set not null;
-- llm_usage.workspace_id stays nullable: Ask calls aren't tied to one workspace.

create index projects_workspace_id_idx on public.projects (workspace_id);
create index tasks_workspace_id_idx on public.tasks (workspace_id);

-- 4. Keys: a task's project must be in the same workspace ------------------------

alter table public.projects add constraint projects_id_workspace_id_key unique (id, workspace_id);
alter table public.tasks
  add constraint tasks_project_id_workspace_id_fkey
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id)
  on delete set null (project_id);
alter table public.tasks drop constraint tasks_project_id_owner_id_fkey;
alter table public.projects drop constraint projects_id_owner_id_key;

-- Project names are unique per workspace now (they were per user).
create unique index projects_workspace_id_lower_name_key on public.projects (workspace_id, lower(name));
drop index public.projects_owner_id_lower_name_key;

-- 5. Membership policies replace "own rows" -------------------------------------

drop policy "projects: select own" on public.projects;
drop policy "projects: insert own" on public.projects;
drop policy "projects: update own" on public.projects;
drop policy "projects: delete own" on public.projects;
drop policy "tasks: select own" on public.tasks;
drop policy "tasks: insert own" on public.tasks;
drop policy "tasks: update own" on public.tasks;
drop policy "tasks: delete own" on public.tasks;

grant insert (workspace_id) on public.projects to authenticated;
grant insert (workspace_id, assignee_id) on public.tasks to authenticated;
grant update (assignee_id) on public.tasks to authenticated;

create policy "projects: select as viewer"
  on public.projects for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
create policy "projects: insert as member"
  on public.projects for insert to authenticated
  with check (
    workspace_id in (select public.my_workspaces('member'))
    and owner_id = (select auth.uid())
  );
create policy "projects: update as member"
  on public.projects for update to authenticated
  using (workspace_id in (select public.my_workspaces('member')))
  with check (workspace_id in (select public.my_workspaces('member')));
create policy "projects: delete as member"
  on public.projects for delete to authenticated
  using (workspace_id in (select public.my_workspaces('member')));

create policy "tasks: select as viewer"
  on public.tasks for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
create policy "tasks: insert as member"
  on public.tasks for insert to authenticated
  with check (
    workspace_id in (select public.my_workspaces('member'))
    and owner_id = (select auth.uid())
  );
create policy "tasks: update as member"
  on public.tasks for update to authenticated
  using (workspace_id in (select public.my_workspaces('member')))
  with check (workspace_id in (select public.my_workspaces('member')));
create policy "tasks: delete as member"
  on public.tasks for delete to authenticated
  using (workspace_id in (select public.my_workspaces('member')));

-- 6. Series and assignee checks use the workspace ------------------------------

create or replace function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- completed_at follows status; clients never write it.
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;

  if new.recurrence_tz is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.recurrence_tz) then
    raise exception 'invalid time zone: %', new.recurrence_tz using errcode = '22023';
  end if;

  if tg_op = 'INSERT' and new.series_id is not null then
    -- Only complete_task() sets series_id on insert, and only to a series in
    -- the same workspace. This stops occupying another workspace's
    -- (series_id, due_at). (Was: same owner, before step 3.2.)
    if not exists (
      select 1 from public.tasks t
       where t.series_id = new.series_id and t.workspace_id = new.workspace_id
    ) then
      raise exception 'series does not belong to this workspace' using errcode = '42501';
    end if;
  end if;

  -- An assignee must be a member of the task's workspace.
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = new.workspace_id and m.user_id = new.assignee_id
     ) then
    raise exception 'assignee is not a member of this workspace' using errcode = '23514';
  end if;

  if new.recurrence is not null and new.series_id is null then
    new.series_id := new.id;
  end if;

  return new;
end;
$$;

-- 7. complete_task copies the workspace and assignee to the next occurrence -----

create or replace function public.complete_task(p_task_id uuid, p_next_due_at timestamptz default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t public.tasks;
  next_id uuid;
begin
  -- A concurrent second call waits on the row lock, then matches 0 rows.
  update public.tasks
     set status = 'done'
   where id = p_task_id and status <> 'done'
  returning * into t;

  if not found or t.recurrence is null or p_next_due_at is null
     or p_next_due_at <= t.due_at then
    return null;
  end if;

  insert into public.tasks
    (workspace_id, title, notes, priority, project_id, due_at, recurrence, recurrence_tz,
     series_id, assignee_id)
  values
    (t.workspace_id, t.title, t.notes, t.priority, t.project_id, p_next_due_at, t.recurrence,
     t.recurrence_tz, t.series_id, t.assignee_id)
  on conflict (series_id, due_at) do nothing
  returning id into next_id;

  return next_id;
end;
$$;

-- 8. New users get a Personal workspace ------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                               new.raw_user_meta_data ->> 'name')), ''), 100)
  )
  on conflict (id) do nothing;

  if not exists (select 1 from public.workspace_members where user_id = new.id) then
    insert into public.workspaces (name, created_by) values ('Personal', new.id) returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');
  end if;
  return new;
end;
$$;

-- 9. Self-check: abort everything if anything was lost or misplaced --------------

do $$
declare
  b record;
  bad bigint;
begin
  select * into b from _before;

  if (select count(*) from public.profiles) <> b.profiles
     or (select count(*) from public.projects) <> b.projects
     or (select count(*) from public.tasks) <> b.tasks
     or (select count(*) from public.tasks where series_id is not null) <> b.series_rows
     or (select count(*) from public.llm_usage) <> b.llm_usage then
    raise exception 'workspace backfill: row counts changed';
  end if;

  select count(*) into bad from (
    select owner_id, 'projects' as kind, count(*) as n from public.projects group by owner_id
    union all
    select owner_id, 'tasks', count(*) from public.tasks group by owner_id
  ) now_counts
  full join _before_per_owner before_counts using (owner_id, kind)
  where now_counts.n is distinct from before_counts.n;
  if bad > 0 then
    raise exception 'workspace backfill: % per-owner counts changed', bad;
  end if;

  -- Every row sits in its creator's Personal workspace.
  select count(*) into bad from public.projects t
    join _personal m on m.user_id = t.owner_id where t.workspace_id <> m.workspace_id;
  if bad > 0 then raise exception 'workspace backfill: % projects misplaced', bad; end if;
  select count(*) into bad from public.tasks t
    join _personal m on m.user_id = t.owner_id where t.workspace_id <> m.workspace_id;
  if bad > 0 then raise exception 'workspace backfill: % tasks misplaced', bad; end if;

  -- A task and its project are always in the same workspace.
  select count(*) into bad from public.tasks t
    join public.projects p on p.id = t.project_id where p.workspace_id <> t.workspace_id;
  if bad > 0 then raise exception 'workspace backfill: % tasks split from their project', bad; end if;

  -- Every user owns exactly one workspace so far: their Personal one.
  select count(*) into bad from public.profiles p
   where (select count(*) from public.workspace_members m
           where m.user_id = p.id and m.role = 'owner') <> 1;
  if bad > 0 then raise exception 'workspace backfill: % users without one Personal workspace', bad; end if;

  raise notice 'workspace backfill ok: % profiles, % projects, % tasks, % usage rows',
    b.profiles, b.projects, b.tasks, b.llm_usage;
end $$;
