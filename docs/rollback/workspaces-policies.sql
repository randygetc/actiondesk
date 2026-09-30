-- Emergency rollback for step 3.2 (docs/plan.md §4.4). NOT a migration.
-- Restores Phase 1–2 "own rows" access on projects and tasks, using owner_id
-- (kept by the backfill, never changed). Data is untouched; workspace tables
-- stay in place, unused. To apply in prod, copy this into a new migration file
-- (R7: forward-fix only) after taking a backup (docs/deploy.md, step 3.10).

drop policy "projects: select as viewer" on public.projects;
drop policy "projects: insert as member" on public.projects;
drop policy "projects: update as member" on public.projects;
drop policy "projects: delete as member" on public.projects;
drop policy "tasks: select as viewer" on public.tasks;
drop policy "tasks: insert as member" on public.tasks;
drop policy "tasks: update as member" on public.tasks;
drop policy "tasks: delete as member" on public.tasks;

create policy "projects: select own" on public.projects for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "projects: insert own" on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "projects: update own" on public.projects for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "projects: delete own" on public.projects for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "tasks: select own" on public.tasks for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "tasks: insert own" on public.tasks for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "tasks: update own" on public.tasks for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "tasks: delete own" on public.tasks for delete to authenticated
  using (owner_id = (select auth.uid()));
