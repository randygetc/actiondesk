# Performance at 100k tasks (step 3.7, 2026-10-01)

Measured locally: Supabase local stack, production build (`next start`), 14-core machine.
Rule 13 applies: nothing was changed without before/after numbers, and two changes that didn't
measure up were reverted.

## Data set
`supabase/perf/seed.sql` (local only):
- 5 users (`perf1..5@example.com`) with overlapping memberships: each owns 4 workspaces, is a member of
  4 and a viewer of 4.
- 20 workspaces, 500 projects, **100,000 tasks** (5,000 per workspace): 40% done, 10% doing,
  50% todo; due dates spread over ±60 days (30% none); 70% in a project; 5% weekly recurring.
- perf1 sees 60,000 tasks through RLS.

## Method
- **Queries:** `supabase/perf/measure.py` runs each of the app's hot queries 7 times under `EXPLAIN (ANALYZE, BUFFERS)` **as a
  signed-in user** (role `authenticated` + JWT claims, so RLS is included), and reports the median.
- **Load:** `supabase/perf/k6/load.js` (k6 in Docker) has two modes:
  - a stress ramp: 20 virtual users, no pause between requests, on `/tasks` and on Ask's data path
    (PostgREST with the user's token);
  - a steady rate (`RATE=n`).
  - The AI call itself isn't load-tested: it would cost money and measure Anthropic's latency.
- **Profiling:** a Node CPU profile of the production server for `/tasks`.

## RLS design check (plan §4.2)
The policies use `workspace_id in (select my_workspaces(...))`, a set-based helper that runs once per
query. For comparison, the same query with a per-row `is_member()` policy (swapped in a rolled-back
transaction):

| Query | set-based (shipped) | per-row |
|---|---|---|
| Task list, one 5,000-task workspace | **14.5 ms** | 1,034 ms |
| `count(*)` of all 60,000 visible tasks | **23.7 ms** | 18,984 ms |

No RLS change needed.

## Queries (median ms, as a signed-in user)

| Query | Before | After | Change |
|---|---|---|---|
| Task list (old single 500-row query) | 9.7 | 3.4 | `tasks_workspace_open_due_idx`: index scan in due order, no sort |
| Tasks page, one group (since 3.7) + its count | n/a | 7.6 + 5.8 | groups queried by range, 50 rows each |
| Project page: open tasks | 24.7 | 3.5 | `tasks_project_id_idx` (was a full scan of all 100k tasks) |
| Project page: delete-warning count | 36.1 | 3.8 | same |
| Ask `list_overdue` | 9.4 | 3.5 | `tasks_workspace_open_due_idx` |
| Ask project summary | 12.2 | 5.9 | `tasks_project_id_idx` |
| Ask `search_tasks` (`ilike '%…%'`) | 19.9 | 10–28 (noisy) | not changed (see "Rejected") |
| Projects list | 2.4 | 3.5 | not changed (noise) |
| Workspace switcher | 3.7 | 3.9 | not changed |
| AI cap check (`llm_spend_recent`) | 2.4 | 2.5 | not changed |
| Digest data (weekly, service role) | 24.8 | 26–34 | not changed: once per member per week |

## The tasks page under load

The database wasn't the bottleneck. One request spent ~280 ms, of which the queries were ~10 ms. The CPU profile
showed ~40 ms in per-row date code (the Temporal polyfill and a new `Intl.DateTimeFormat` per row) and
~70 ms rendering 500 rows (~1 MB of HTML plus the RSC payload). A single Node process serves concurrent
requests one at a time, so 20 users queue.

| `/tasks`, 5,000-task workspace | Before | Date fix | + per-group queries |
|---|---|---|---|
| Response | 1,009 KB, 500 rows | 1,009 KB | **311 KB, 150 rows** |
| Single request | ~280 ms | ~270 ms | **~240 ms** |
| Stress (20 users, no pause): median / p95 | 4.14 s / 5.41 s | 2.47 s / 3.42 s | **1.30 s / 2.03 s** |
| Steady 5 req/s: p95 | n/a | n/a | **266 ms** |
| Steady 10 req/s: p95 | n/a | n/a | **230 ms** |

1. **Date fix:** cached formatters per zone, and "today" and "this Sunday" computed once per list. The
   per-page date work went from 40 ms to 4 ms. All 78 time tests (DST edge cases included) passed unchanged.
2. **Per-group queries (owner decision):** each group (Overdue, Today, This week, Later, No date) is its own
   due_at range query with the first 50 rows and an exact count. "Show all (N)" shows up to 500.
   `groupBounds()` is proven equal to `groupFor()` for every hour around both DST changes in four zones.
   This also **fixed a bug**: with more than 500 dated open tasks, the "No date" group never appeared,
   because rows were cut off before grouping.

Ask's data path stayed fast throughout: p95 76–130 ms under the 20-user stress test, 0 errors in about 27k requests.

The 20-user stress p95 (2.0 s) is over the 500 ms target. That figure is one local Node process taking ~15
page renders per second; on Vercel, concurrent requests can run on separate instances. At realistic
steady rates the p95 is ~230–270 ms. Re-check on the first Vercel preview (3.10).

## Production: Vercel + Supabase (step 3.10, 2026-10-02, R-35)

Vercel (sfo1, Hobby) and Supabase (us-west-1, Free). One test account with a seeded 5,000-task workspace,
removed afterwards. k6 ran from the owner's machine, so every time includes the network: connecting takes
~55 ms, a near-empty dynamic page (`/login`) has its first byte at ~270 ms, and the 292 KB tasks page
downloads in ~100 ms. Warm, a single `/tasks` request has its first byte at ~650 ms. That's ~350–400 ms
of server time, against ~240 ms locally.

| `/tasks`, 5,000-task workspace | Local (`next start`, one process) | Production (Vercel) |
|---|---|---|
| Steady 5 req/s: median / p95 | n/a / 266 ms | 682 ms / 1.03 s |
| Steady 10 req/s: median / p95 | n/a / 230 ms | 689 ms / 895 ms |
| Stress (20 users, no pause): median / p95 | 1.30 s / 2.03 s | 1.24 s / 1.90 s |
| Errors | 0 | 0 of ~5,600 page loads |

Ask's data path (PostgREST with the user's token) under the stress run: median 193 ms, p95 545 ms, 0
errors.

**Reading it:**
- Production latency is mostly network plus a slower function than a local machine. It doesn't grow with
  load: 5 → 10 req/s didn't change it.
- Under the 20-user stress run, Vercel's p95 (1.9 s, network included) is about the same as one local
  process (2.0 s, no network). So concurrency does help, but per-request render time dominates.
- The 500 ms p95 target isn't met from this distance. The next lever is page size and render work
  (~150 rows, 292 KB), not the database: the Ask queries stay fast. Not optimized now (rule 13: this is the
  measurement; any change needs its own before/after).


- **`pg_trgm` GIN index on `tasks.title`** for `search_tasks`: the planner kept using the workspace index
  (search time unchanged), and inserting 5,000 tasks went from 150 ms to 202 ms (+35% on every write).
- **Per-request memoization** (`React.cache`) of `requireUser`/`currentWorkspace` (shared by the layout and
  page): median 2.47 → 2.49 s, p95 3.42 → 3.31 s, which is noise. It was reverted to keep the code simpler.

## Other measurements
- **Bulk migrations:** updating all 100,000 task rows takes ~12 s, holding row locks the whole time. The 3.2
  backfill ran on little data, and prod starts fresh at 3.10. Future bulk changes on big tables should be
  batched, and indexes created `concurrently` outside a migration transaction.

## Re-running
```
docker exec -i supabase_db_actiondesk psql -U postgres < supabase/perf/seed.sql
python3 supabase/perf/measure.py <label>
npm run build && npx next start -p 3100 -H 127.0.0.1 &
node supabase/perf/k6/sessions.mjs > /tmp/k6data/users.json   # tokens: keep outside the repo
docker run --rm --network host -v "$PWD/supabase/perf/k6":/k6 -v /tmp/k6data:/data \
  -e APP=http://127.0.0.1:3100 -e SUPABASE_URL=http://127.0.0.1:54321 -e ANON_KEY=<publishable key> \
  [-e RATE=10] grafana/k6 run /k6/load.js
```
