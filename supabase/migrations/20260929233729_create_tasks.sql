-- Step 1.7: tasks with preset recurrence (docs/plan.md §2.1, §2.2; D-3 to D-7).

create type public.task_status as enum ('todo', 'doing', 'done');
create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  project_id uuid,
  title text not null check (title = btrim(title) and char_length(title) between 1 and 200),
  notes text check (char_length(notes) <= 10000),
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'normal',
  due_at timestamptz,
  -- RRULE body without DTSTART; only the UI presets are allowed (D-6).
  -- Mirrors src/lib/time/recurrence.ts.
  recurrence text check (recurrence ~ (
    '^(FREQ=DAILY'
    || '|FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    || '|FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)'
    || '|FREQ=WEEKLY;INTERVAL=([2-9]|[1-4][0-9]|5[0-2]);BYDAY=(MO|TU|WE|TH|FR|SA|SU)'
    || '|FREQ=MONTHLY;BYMONTHDAY=([1-9]|1[0-9]|2[0-8]|-1)'
    || '|FREQ=MONTHLY;BYDAY=([1-4]|-1)(MO|TU|WE|TH|FR|SA|SU))$'
  )),
  -- IANA zone the rule is anchored to, fixed at creation (D-5).
  recurrence_tz text,
  -- Shared by every occurrence of a recurring task: the first task's id.
  series_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A task can only point at a project with the same owner, even if RLS had a bug.
  -- Deleting the project clears only project_id (D-3).
  foreign key (project_id, owner_id) references public.projects (id, owner_id)
    on delete set null (project_id),
  check ((status = 'done') = (completed_at is not null)),
  check (recurrence is null
         or (due_at is not null and recurrence_tz is not null and series_id is not null)),
  -- Completing twice (double click, retry, race) can't create two next occurrences.
  unique (series_id, due_at)
);

alter table public.tasks enable row level security;

-- Derived columns and cross-row checks. security invoker: the series lookup
-- sees only the caller's own tasks under RLS.
create function public.tasks_before_write()
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
    -- Only complete_task() sets series_id on insert, and only to a series the
    -- caller already owns. This stops occupying another user's (series_id, due_at).
    if not exists (
      select 1 from public.tasks t
       where t.series_id = new.series_id and t.owner_id = new.owner_id
    ) then
      raise exception 'series does not belong to this user' using errcode = '42501';
    end if;
  end if;

  if new.recurrence is not null and new.series_id is null then
    new.series_id := new.id;
  end if;

  return new;
end;
$$;

create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Privileges: owner_id, completed_at and timestamps are never client-written.
-- series_id is insertable only so complete_task() (security invoker) can add
-- the next occurrence; the trigger restricts it to the caller's own series.
revoke all on public.tasks from anon, authenticated;
grant select, delete on public.tasks to authenticated;
grant insert (title, notes, status, priority, due_at, recurrence, recurrence_tz, project_id, series_id)
  on public.tasks to authenticated;
grant update (title, notes, status, priority, due_at, recurrence, recurrence_tz, project_id)
  on public.tasks to authenticated;

create policy "tasks: select own"
  on public.tasks for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "tasks: insert own"
  on public.tasks for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "tasks: update own"
  on public.tasks for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "tasks: delete own"
  on public.tasks for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- Marks a task done and, for a recurring task, inserts the next occurrence.
-- The next due date is computed in TypeScript (src/lib/time/recurrence.ts);
-- this function only makes the pair atomic and idempotent.
-- security invoker: RLS applies, so another user's task matches 0 rows.
-- Returns the new occurrence's id, or null when nothing was created.
create function public.complete_task(p_task_id uuid, p_next_due_at timestamptz default null)
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
    (title, notes, priority, project_id, due_at, recurrence, recurrence_tz, series_id)
  values
    (t.title, t.notes, t.priority, t.project_id, p_next_due_at, t.recurrence, t.recurrence_tz, t.series_id)
  on conflict (series_id, due_at) do nothing
  returning id into next_id;

  return next_id;
end;
$$;

revoke execute on function public.complete_task(uuid, timestamptz) from public, anon;
grant execute on function public.complete_task(uuid, timestamptz) to authenticated;
revoke execute on function public.tasks_before_write() from public, anon, authenticated;
