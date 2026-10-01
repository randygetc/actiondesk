-- Step 3.7: indexes justified by measurements at 100,000 tasks (rule 13).
-- Numbers in docs/performance.md. Rejected after measuring: a pg_trgm index
-- for title search (not used by the planner; +35% insert time).

-- The project page and Ask's project summary scanned every task in the
-- database (~25–36 ms at 100k): now ~4 ms. Also the FK index deferred by R-9.
create index tasks_project_id_idx on public.tasks (project_id);

-- Open tasks in due order per workspace: the task list's groups and Ask's
-- list_overdue read straight from it, with no sort (~10 ms → ~3.5 ms).
create index tasks_workspace_open_due_idx on public.tasks (workspace_id, due_at)
  where status <> 'done';
