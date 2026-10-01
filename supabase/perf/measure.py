#!/usr/bin/env python3
"""Step 3.7: time the app's hot queries as a signed-in user (RLS included).

    python3 supabase/perf/measure.py [label]

Runs each query 7 times under EXPLAIN (ANALYZE, BUFFERS) as perf1@example.com
(role authenticated + JWT claims), in a workspace perf1 owns, and prints the
median execution time. Plans are saved to supabase/perf/plans/<label>/.
The SQL mirrors what PostgREST runs for the app's queries (src/app/**,
src/lib/llm/tools/tasks.ts). Local only.
"""
import os, re, statistics, subprocess, sys

LABEL = sys.argv[1] if len(sys.argv) > 1 else "run"
DB = ["docker", "exec", "-i", "supabase_db_actiondesk", "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"]

def psql(sql):
    return subprocess.run(DB, input=sql, capture_output=True, text=True, check=True).stdout

ids = psql("""
select u.id, m.workspace_id,
       (select p.id from public.projects p where p.workspace_id = m.workspace_id order by name limit 1)
  from auth.users u join public.workspace_members m on m.user_id = u.id and m.role = 'owner'
  join public.workspaces w on w.id = m.workspace_id and w.name like 'Perf workspace %'
 where u.email = 'perf1@example.com' order by w.name limit 1;
""").strip().split("|")
USER, WS, PROJECT = ids

AS_USER = f"""
select set_config('request.jwt.claims', '{{"sub":"{USER}","role":"authenticated","aal":"aal1"}}', true);
set local role authenticated;
"""

QUERIES = {
    # Tasks page: open tasks in the current workspace, with each task's project (PostgREST embeds via lateral).
    "task_list": f"""select t.id, t.title, t.notes, t.status, t.priority, t.due_at, t.recurrence, t.project_id, pj.p
      from public.tasks t left join lateral (select json_build_object('id', p.id, 'name', p.name) p
                                               from public.projects p where p.id = t.project_id) pj on true
     where t.workspace_id = '{WS}' and t.status <> 'done' order by t.due_at asc nulls last limit 500""",
    # Tasks page since 3.7: one query per group (here Overdue, the largest) for
    # the first 50 rows, plus PostgREST's exact count for "Show all".
    "task_group_overdue": f"""select t.id, t.title, t.status, t.priority, t.due_at, pj.p
      from public.tasks t left join lateral (select json_build_object('id', p.id, 'name', p.name) p
                                               from public.projects p where p.id = t.project_id) pj on true
     where t.workspace_id = '{WS}' and t.status <> 'done' and t.due_at < now() order by t.due_at limit 50""",
    "task_group_count": f"""select count(*) from public.tasks
     where workspace_id = '{WS}' and status <> 'done' and due_at < now()""",
    # Project page: open tasks of one project, plus the delete-warning count.
    "project_tasks": f"""select id, title, status, priority, due_at, recurrence from public.tasks
     where project_id = '{PROJECT}' and status <> 'done' order by due_at asc nulls last limit 200""",
    "project_task_count": f"select count(*) from public.tasks where project_id = '{PROJECT}'",
    # Projects page.
    "project_list": f"""select id, name, archived_at from public.projects
     where workspace_id = '{WS}' and archived_at is null order by name""",
    # Ask tools.
    "search_tasks": f"""select t.id, t.title, t.status, t.priority, t.due_at from public.tasks t
     where t.workspace_id = '{WS}' and t.title ilike '%invoice 12%' order by t.due_at asc nulls last limit 20""",
    "list_overdue": f"""select t.id, t.title, t.status, t.priority, t.due_at from public.tasks t
     where t.workspace_id = '{WS}' and t.due_at < now() and t.status <> 'done' order by t.due_at limit 50""",
    "project_summary": f"""select id, status, due_at from public.tasks
     where project_id = '{PROJECT}' and workspace_id = '{WS}' order by due_at asc nulls last limit 500""",
    # Every page: the workspace switcher.
    "my_workspaces": f"""select m.role, w.id, w.name from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id where m.user_id = '{USER}'""",
    # Every LLM call: the cap.
    "llm_spend_recent": "select public.llm_spend_recent()",
}
# The digest runs as service_role (no RLS), once per recipient.
SERVICE = {
    "digest_data": f"select public.digest_data('{WS}', 'Asia/Manila')",
}

os.makedirs(f"supabase/perf/plans/{LABEL}", exist_ok=True)

def measure(name, sql, as_user):
    times, plan = [], ""
    for _ in range(7):
        out = psql("begin;\n" + (AS_USER if as_user else "") +
                   f"explain (analyze, buffers, format text) {sql};\nrollback;\n")
        plan = out
        times.append(float(re.search(r"Execution Time: ([\d.]+) ms", out).group(1)))
    open(f"supabase/perf/plans/{LABEL}/{name}.txt", "w").write(plan)
    return statistics.median(times)

print(f"{'query':22} {'median ms':>10}")
for name, sql in QUERIES.items():
    print(f"{name:22} {measure(name, sql, True):10.2f}")
for name, sql in SERVICE.items():
    print(f"{name:22} {measure(name, sql, False):10.2f}  (service_role)")
