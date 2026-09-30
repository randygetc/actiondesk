# Plan

Written by Claude Code in step 1.1. Editable. Must conform to docs/architecture.md.

- **Last updated:** 2026-09-30 (step 3.1: Phase 3 plan)
- **Sources:** CLAUDE.md, docs/architecture.md, docs/adr/0001–0005, docs/KICKOFF.md, guardrails/, .claude/
- **Scope:** Phases 1 and 2 are done. Phase 3 is detailed in §4 (3.1).
- **Needs your decision:** the owner items in §7 (risks and gaps in the guardrails). All §6 decisions are made.

## 0. Status

| Step | What | State |
|---|---|---|
| 1.1 | Plan | done; owner decisions in §6 |
| 1.2 | Lock architecture (owner) | done: CODEOWNERS, `main` ruleset (PR + `guardrails` check, 0 approvals), label, lock test (ADR-0006 rejected) |
| 1.3 | Scaffold | done (PR #4) |
| 1.4 | Prove guardrails | done: all four caught in CI (draft PR #6, results in its comments); owner closes it |
| 1.5 | Google sign-in + profiles | done (PR #5); real Google sign-in verified 2026-09-30 (one profile after repeat sign-in) |
| 1.6 | Projects CRUD (vague prompt) | done (PR #7) |
| 1.7 | Tasks CRUD (full spec) | done (PR #8); library: temporal-polyfill (R-8), date-only = 23:59 local |
| 1.8 | Timezone edge cases | done (PR #9); found spring-forward drift, fixed by storing the local time in the rule (owner decision) |
| 1.9 | CI | done (PR #10); `ci` is a required check on `main` |
| P1 | Phase 1 checkpoint | done; summary in §0.1. Owner: friction debrief in docs/learnings.md |
| 2.1 | Phase 2 plan + streaming spike | done (PR #12); spike passed (§3.1), no ADR; D-19–D-21 decided |
| 2.2 | Evals first | done (PR #13); 19 cases **drafted by Claude at the owner's request** (KICKOFF has the owner write them; owner reviews `expected.json`) |
| 2.3 | Extraction | done (PR #14): live eval 98% on claude-opus-5-5 |
| 2.4 | Model comparison | done (PR #15): owner chose claude-sonnet-5-5 |
| 2.5 | Ask ActionDesk | done (PR #16) |
| 2.6 | Cost controls | done (PR #17) |
| 2.7 | Attachments | done (PR #18) |
| 2.8 | Injection hardening | done (PR #19): Ask injection eval (gate); security review, 8 findings fixed, 5 deferred (§7) |
| P2 | Phase 2 checkpoint | done; summary in §0.2. Owner: friction debrief in docs/learnings.md |
| 3.1 | Phase 3 plan | PR open on `phase3/plan`: workspaces refactor detailed (§4); D-23–D-25 decided |
| 3.2–3.12 | Workspaces, jobs, prod | detailed in §4; not started |

### 0.1 Phase 1 summary (2026-09-30)

**Built:**
- Google sign-in, profiles with timezone, and a settings page.
- Projects CRUD with archive and restore.
- Tasks CRUD:
  - due dates entered in the profile timezone and stored as UTC;
  - six recurrence presets;
  - `complete_task()` that is atomic and idempotent;
  - list grouped as Overdue / Today / This week / Later.
- 4 migrations, each with RLS and pgTAP (103 assertions).
- Tests: 138 unit, 1 concurrent DB test (`complete_task`), 15 Playwright e2e.
- CI (`ci.yml`), a required check alongside `guardrails`.

**Checkpoint:**
- Google sign-in verified by hand on 2026-09-30.
- All the time zone tests pass, and CI is green.
- All four violations in 1.4 were caught by CI (PR #6).

**What changed from the plan:**
- **Middleware became `src/proxy.ts`** because Next 16 renamed it. It refreshes the session only; it doesn't authorize.
- **Recurrence rules now carry their local time** (`BYHOUR`/`BYMINUTE`, migration `20260930003644`). This was added in 1.8 after a spring-forward bug: 02:30 shifted to 03:30 in every later occurrence.
- **1.4 ran after 1.5** (D-9), so there was a migration on `main` to edit.
- **New Vitest `db` project** (`npm run test:db`) for the concurrent `complete_task` test, which pgTAP can't express. CI runs it too.
- **CI pins the Supabase CLI** (2.118.0) and uses placeholder Google OAuth values; no secrets needed.

**Open issues carried into Phase 2:**
- Owner: R-1 (no hook blocks editing migrations during the session) and R-2 (architecture.md §6 names an ESLint rule that doesn't exist).
- R-3 still stands; client components must stay in `src/components/`.
- R-9: no foreign-key or `due_at` indexes until measured at 3.7.
- The 2.x steps are outline only; step 2.1 details them.

### 0.2 Phase 2 summary (2026-09-30)

**Built:**
- **Capture** (`/capture`): paste notes or upload a PDF, .docx, .txt or .vtt/.srt file.
  - Tasks stream into a review list: edit, reject or accept each; low-confidence rows are flagged.
  - Only accepted rows are saved, re-validated with the task form's schema.
  - Uploaded files are deleted after review.
- **Ask ActionDesk:** a chat panel with `search_tasks`, `list_overdue`, `get_project_summary` and a proposal-only `create_task` (Confirm to save). Tools run as the signed-in user.
- **Cost controls:**
  - `llm_usage` logs every call, aborted ones included.
  - A per-user cap over a rolling 24 hours ($1 by default).
  - Prompt caching (−28% extraction cost).
  - An admin usage page (admins are added by SQL).
- **Evals:**
  - 22 extraction cases: 98% on claude-sonnet-5-5 at $0.006 per case. They include 3 attachment cases and 3 injection cases.
  - The Ask injection eval, a gate in CI.
  - Both replay recordings in CI, so no key is needed.
- **Database:** 5 migrations with pgTAP 005–009, adding `llm_usage`, task provenance, `app_admins`, `attachments`, the storage bucket and policies, and the review fixes.
- **Tests:** 235 unit, 11 db (including user B vs user A through every Ask tool), and 27 e2e.

**Checkpoint (KICKOFF):**
- Paste notes and get reviewed tasks saved with correct dates in your time zone: e2e, plus live checks.
- The eval score is recorded and CI runs the evals in recorded mode.
- Ask can't see other users' data: a db test through each tool and through the full loop.
- Usage is logged and the cap enforced: pgTAP, db tests, e2e, and a live abort check.
- Attachments produce tasks; oversized, wrong-type, zip-bomb and hidden-instruction files are handled safely: unit tests, e2e and evals.

**What changed from the plan:**
- **Models:** extraction and Ask run on claude-sonnet-5-5 (owner decision at 2.4). Opus 5.5 and Haiku 4.5 were compared, with the results in docs/learnings.md.
- **Eval cases** were drafted by Claude at the owner's request, not written by the owner (KICKOFF 2.2). The owner still needs to review `expected.json`.
- **Title matching** in the scorer changed from Jaccard ≥ 0.5 to overlap with the shorter title ≥ 0.6 (2.3).
- **Due dates** come from the model as local date + time, not ISO with an offset (D-20).
- **Streaming (the 2.1 spike, result d):** `finally` isn't reliable when the client disconnects. Usage is recorded through `usageRun()` and `after()` (2.8).
- **The daily cap** is a rolling 24-hour window instead of local midnight (review #2).
- **New Supabase functions:** `llm_spend_recent`, `llm_usage_report`. `llm_spend_today` was dropped.
- **Bugs found by live checks,** which unit tests missed:
  - Strict tool schemas reject `enum` on a nullable type.
  - Dated model ids broke pricing.
  - The proxy's 10 MB body limit truncated uploads.
  - Aborted streams were never logged.

**Open issues carried into Phase 3:**
- **Owner:**
  - R-14: parallel cap overshoot. Reserve spend before each call, or allow one call in flight per user.
  - R-23: forged usage rows. An ADR for a server-only write path.
  - R-1 and R-2 from Phase 1.
- **Carried:**
  - R-18: check streaming buffering on Vercel.
  - R-20: a cron job to clean up leftover attachments.
  - R-24: the global body limit.
  - R-26: data framing for member-written context once workspaces exist.
  - The three ambiguous project labels in the eval.

## 1. Conventions this plan assumes

These apply to every phase. Once they're confirmed in code, move them into docs/conventions.md.

- **Clients.** Server Components, Server Actions and route handlers use `createClient()` from `src/lib/supabase/server.ts`. The browser uses `src/lib/supabase/client.ts` only for reads and Realtime (ADR-0004). `src/lib/supabase/admin.ts` is not used in Phase 1 at all.
- **Auth on the server.** Every Server Action and protected layout calls `supabase.auth.getUser()` and gets its user id from that call, never from input.
- **Server Action shape.** Each action:
  1. parses its input with a Zod schema from `src/lib/validation/<entity>.ts`,
  2. calls `getUser()`,
  3. runs the query with the user client (RLS decides access),
  4. returns `{ ok: true, data } | { ok: false, error }`, and calls `revalidatePath` where needed.

  Actions never throw raw database errors to the client.
- **Time.**
  - The database stores `timestamptz` in UTC.
  - Conversion between UTC and a zone happens only in `src/lib/time/`: pure functions that take an explicit `now` and `tz`, with no hidden `Date.now()` and no `process.env.TZ`.
  - The UI renders in `profiles.timezone`, not the browser's zone.
- **RLS policy style.**
  - Use one policy per operation (`select`, `insert`, `update`, `delete`). Avoid `for all` so tests map 1:1 to policies.
  - Use `to authenticated`.
  - Write `(select auth.uid())` rather than `auth.uid()` so Postgres evaluates it once per query instead of once per row.
- **pgTAP layout.** Tests go in `supabase/tests/NNN_<table>.test.sql`. Each policy gets at least three cases: owner allowed, other user denied, anon denied. They use shared helpers for creating users and switching `request.jwt.claims`, in `supabase/tests/helpers/auth.psql` (decided at 1.5; see docs/conventions.md).
- **Indexes.** Phase 1 adds only primary keys and unique constraints that exist for correctness. Rule 13 means no performance indexes until step 3.7 measures them (see risk R-9).
- **Logging.** Everything goes through one structured logger, `src/lib/log.ts`. The minimal version is added at 1.3; Sentry and request IDs come at 3.8. It never logs titles, notes, extracted text, file contents, tokens or keys; ids and counts only.

---

## 2. Phase 1 — Foundation (full detail)

**Goal:** a single-user task tracker with Google sign-in, recurring tasks, timezone-correct due dates, tests and CI.

**Ownership model.** In Phase 1, rows carry `owner_id` rather than `workspace_id`. KICKOFF 3.1 deliberately makes the move to workspaces a later refactor (friction exercise F). docs/architecture.md §3 describes the end state ("almost every row carries workspace_id"), so this is a staging choice, not a deviation. See decision D-1.

### 2.1 Data model

#### `profiles`

| column | type | notes |
|---|---|---|
| id | uuid PK | references `auth.users(id) on delete cascade` |
| display_name | text | nullable; seeded from Google `full_name` |
| timezone | text not null | default `'America/Los_Angeles'`; must be a valid IANA name (see below) |
| created_at / updated_at | timestamptz not null | `default now()`; `updated_at` maintained by a shared trigger |

- **Timezone validation** happens twice:
  - Zod refinement: the name must be in `Intl.supportedValuesOf('timeZone')`.
  - A DB trigger rejects names that are not in `pg_timezone_names`. A CHECK constraint can't use a subquery.
- **Profile creation.** The trigger `on_auth_user_created` on `auth.users` calls `public.handle_new_user()`, which inserts the profile. The function is `security definer` with `set search_path = ''`.

#### `projects`

| column | type | notes |
|---|---|---|
| id | uuid PK | `default gen_random_uuid()` |
| owner_id | uuid not null | references `profiles(id) on delete cascade`, `default auth.uid()` |
| name | text not null | 1–100 chars after trim |
| archived_at | timestamptz | null means active (see D-3) |
| created_at / updated_at | timestamptz not null | |

- `unique (owner_id, lower(name))`: no duplicate project names per user.
- `unique (id, owner_id)`: target for the composite FK from `tasks`.

#### `tasks`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| owner_id | uuid not null | references `profiles(id) on delete cascade`, `default auth.uid()` |
| project_id | uuid null | composite FK `(project_id, owner_id)` → `projects(id, owner_id)`. A task can never point at someone else's project, even if RLS had a bug. |
| title | text not null | 1–200 chars |
| notes | text null | ≤ 10,000 chars |
| status | `task_status` enum | `todo` \| `doing` \| `done`, default `todo` |
| priority | `task_priority` enum | `low` \| `normal` \| `high` \| `urgent`, default `normal` (D-4) |
| due_at | timestamptz null | UTC instant |
| recurrence | text null | RRULE body without DTSTART, e.g. `FREQ=WEEKLY;BYDAY=TU;INTERVAL=2` |
| recurrence_tz | text null | IANA zone the rule is anchored to (D-5); required when `recurrence` is set |
| series_id | uuid null | shared by every occurrence of a recurring task; set to the first task's id |
| completed_at | timestamptz null | |
| created_at / updated_at | timestamptz not null | |

Constraints:
- `check ((status = 'done') = (completed_at is not null))`
- `check (recurrence is null or (due_at is not null and recurrence_tz is not null and series_id is not null))`
- `unique (series_id, due_at)`: completing twice (a double click or a retry) can't create two next occurrences.

Project deletion: `on delete set null` for the project FK (D-3).

#### Functions

- `public.complete_task(p_task_id uuid, p_next_due_at timestamptz)`
  - `security invoker`, so RLS applies.
  - Runs in one transaction. It marks the task done with `completed_at = now()`. If `p_next_due_at` is not null, it inserts the next occurrence with the same series, title, notes, project, priority and recurrence, using `on conflict (series_id, due_at) do nothing`.
  - It is idempotent: it does nothing if the task is already done.
  - The next due date is computed in TypeScript (`src/lib/time/recurrence.ts`), because RRULE expansion doesn't belong in SQL. The function only needs to be atomic.
- `public.set_updated_at()`: shared trigger function.
- `public.handle_new_user()`: see `profiles` above.

### 2.2 RLS policies (Phase 1)

All policies are `to authenticated`. `anon` gets nothing, and there are no policies for `anon`.

| table | select | insert | update | delete |
|---|---|---|---|---|
| profiles | `id = (select auth.uid())` | none (the trigger creates rows) | `id = (select auth.uid())`, with the same check | none (cascade from `auth.users`) |
| projects | `owner_id = (select auth.uid())` | with check `owner_id = (select auth.uid())` | using and with check on owner | `owner_id = (select auth.uid())` |
| tasks | `owner_id = (select auth.uid())` | with check on owner (the composite FK covers the project) | using and with check on owner | `owner_id = (select auth.uid())` |

pgTAP coverage for each table and operation:
- the owner can do it;
- user B gets 0 rows, or an insert or update is rejected;
- anon is rejected.

Extra cases:
- user B cannot insert a task pointing at user A's project (the FK fails);
- no one can update `profiles.id`;
- `complete_task` on someone else's task affects 0 rows.

`000_rls_enabled` must stay green.

### 2.3 Routes and modules

```
src/app/
  login/page.tsx                 public; "Sign in with Google"
  auth/callback/route.ts         exchangeCodeForSession, then redirect to ?next (same-origin paths only)
  auth/signout/actions.ts        signOut Server Action (POST only)
  (app)/layout.tsx               getUser(); redirect to /login if there is no user
  (app)/page.tsx                 redirect to /tasks
  (app)/tasks/page.tsx           grouped list: Overdue / Today / This week / Later / No date / Done (collapsed)
  (app)/tasks/actions.ts         createTask, updateTask, completeTask, reopenTask, deleteTask
  (app)/projects/page.tsx        list + create
  (app)/projects/[id]/page.tsx   project detail with its tasks
  (app)/projects/actions.ts      createProject, renameProject, archiveProject, deleteProject
  (app)/settings/page.tsx        display name, timezone picker
  (app)/settings/actions.ts      updateProfile
middleware.ts                    @supabase/ssr session refresh; redirects unauthenticated users on (app) paths
src/lib/supabase/{server,client,admin}.ts
src/lib/llm/index.ts             placeholder that imports server-only; no SDK until Phase 2
src/lib/validation/{profile,project,task}.ts
src/lib/time/{zones,grouping,recurrence}.ts
src/lib/log.ts
src/components/                  UI only; never imports lib/llm, lib/admin or admin.ts (R6)
```

Next.js 16 renames `middleware.ts` to `proxy.ts`. Use whichever the scaffolded version expects (verify at 1.3).

The edit task UI is a dialog on `/tasks`, not a separate route.

### 2.4 Steps and acceptance criteria

**1.3 Scaffold** (branch `phase1/scaffold`, PR, don't merge)

Scope:
- Next.js (App Router, TypeScript strict), Tailwind, shadcn/ui, `supabase init` (config already exists; keep it)
- the three Supabase clients
- `src/lib/llm/index.ts` and `admin.ts`, both importing `server-only`
- middleware, the logger
- Vitest and Playwright configs
- npm scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `eval` (a stub for now)

Ask before installing anything. Expected dependencies:
- runtime: `next`, `react`, `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `server-only`, `tailwindcss`, shadcn's peer dependencies
- dev: `typescript`, `eslint`, `vitest`, `@playwright/test`, `dependency-cruiser`, `prettier`

The Tailwind and shadcn dependencies should be confirmed at the ask. `server-only` is listed as a dev dependency in KICKOFF; it goes in `dependencies` (runtime) instead (D-10, accepted).

Acceptance:
- [ ] `npm run dev` serves `/login`.
- [ ] `supabase start` runs clean and `supabase test db` passes (000 only).
- [ ] `npx depcruise --config guardrails/dependency-cruiser.cjs src` passes, including the required `server-only-in-llm-and-admin` rule.
- [ ] `npm run lint`, `npm run typecheck` and `npm test` (one trivial test) pass.
- [ ] Vitest resolves `server-only` to a no-op, so server modules are unit-testable (R-6).
- [ ] `.env.local.example` lists variable names only. `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` have no `NEXT_PUBLIC_` prefix.
- [ ] The PR is open and the `guardrails` job is green.

**1.4 Prove the guardrails** (throwaway branch, draft PR, close without merging)

| # | Violation | Expected catcher |
|---|---|---|
| 1 | `src/components/X.tsx` imports `@anthropic-ai/sdk` | dependency-cruiser `R2-anthropic-sdk-only-in-llm` |
| 2 | a Server Action in `src/app/**/actions.ts` imports `src/lib/supabase/admin.ts` | dependency-cruiser `R3-admin-client-restricted` |
| 3 | a new migration creates a table without RLS | `000_rls_enabled.test.sql` (pgTAP in the guardrails job) |
| 4 | edit a migration already on `main` | `guardrails/check.sh` (append-only check) |

Acceptance:
- [ ] Each violation is in its own commit, and the report names the check and job that failed.
- [ ] Nothing is "fixed" or bypassed.

Violation 1 needs `@anthropic-ai/sdk` installed, or depcruise may report it as unresolvable instead (to be verified). Violation 4 needs a migration on `main` first; 1.5's migration is the first candidate, so 1.4 runs after the 1.5 PR is merged (D-9, accepted).

**1.5 Google sign-in + profiles**

Migration `create_profiles` via `/migrate`.

Config (`supabase/config.toml` is not a locked path):
- enable `[auth.external.google]` with `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`;
- fix `additional_redirect_urls`, which currently lists `https://127.0.0.1:3000` (see R-11).

Acceptance:
- [ ] Signing in with Google creates exactly one `profiles` row with the default timezone. Signing in again doesn't duplicate it.
- [ ] `/auth/callback` rejects an absolute or off-site `next` (open-redirect test).
- [ ] Sign-out is POST-only and clears the session cookies.
- [ ] Settings can change the timezone. An invalid zone is rejected by both Zod and the DB.
- [ ] pgTAP covers profiles: own row readable and updatable, other user's row invisible, anon denied, no insert or delete.
- [ ] Playwright: an unauthenticated visit to `/tasks` redirects to `/login`.
- [ ] Playwright: an authenticated user can reach `/settings`. This depends on the e2e auth approach in D-8.

**1.6 Projects CRUD** (friction exercise A: the prompt is "Add projects CRUD.")

The `projects` schema and RLS are defined above because `tasks` depends on them. Acceptance criteria for 1.6 are deliberately left out so the prompt stays vague (D-2, decided 2026-09-29). Judge the result in the 1.6 vs 1.7 debrief.

**1.7 Tasks CRUD** (Plan Mode first; acceptance criteria and tests before implementation)

Migration `create_tasks` via `/migrate`, including the enums, constraints and `complete_task()`.

Acceptance:
- [ ] Create and edit all fields. Due date is entered in the profile timezone and stored as UTC. Clearing the due date clears the recurrence, or the form refuses (Zod mirrors the DB checks).
- [ ] Recurrence UI supports these presets: daily, weekdays, weekly on day X, every N weeks on day X, monthly on day N, monthly on the Nth weekday. Custom RRULE text is out of scope (D-6).
- [ ] Completing a recurring task marks it done and creates exactly one next occurrence, even when the action runs twice concurrently (tested against the unique constraint).
- [ ] Reopening a completed recurring task doesn't delete the already-created next occurrence (D-7).
- [ ] The list is grouped Overdue / Today / This week / Later / No date, computed by `src/lib/time/grouping.ts` from the profile timezone and an injected `now`.
  - "This week" means the rest of the current ISO week (Monday start) in the user's zone (D-6).
  - Done tasks are hidden by default.
- [ ] pgTAP: every tasks policy has owner, other-user and anon cases, plus the cross-owner `project_id` rejection and `complete_task` on another user's task.
- [ ] Vitest: validation schemas, grouping, recurrence (the basics; the edge cases come in 1.8).
- [ ] Playwright: create a task due today → it appears under Today → complete it → it moves to Done.

**1.8 Timezone edge cases** (friction exercise B)

These are Vitest tests with a fixed `now`.

| Case | Setup | Expected |
|---|---|---|
| a | profile tz `America/Los_Angeles`; task due 23:30 local today (07:30 UTC the next day) | grouped as **Today** |
| b | weekly 09:00 Pacific; complete across the first Sunday of November (the change from PDT to PST) | next occurrence is 09:00 local (the UTC hour shifts from 16:00 to 17:00) |
| c | same tasks; the profile changes to `Asia/Manila` | groupings are recomputed in Manila time; stored `due_at` is unchanged |
| d | `FREQ=MONTHLY;BYDAY=2TU` from the 2nd Tuesday of a month, crossing a month boundary | lands on the next month's 2nd Tuesday, local 09:00 |

Additional cases:
- the spring-forward nonexistent time: 02:30 on the March DST date resolves to 03:30 (document the rule);
- a completion that happens after the due date doesn't skip or duplicate occurrences (D-7).

Acceptance:
- [ ] All cases pass.
- [ ] If any failed at first, the fix is in `src/lib/time/` and not in the test.

**1.9 CI**

`.github/workflows/ci.yml` is a separate workflow from the locked guardrails one. It runs install → lint → typecheck → unit → `supabase start` → `supabase test db` → build → Playwright e2e. It doesn't depend on Google OAuth (D-8).

Acceptance:
- [ ] The PR is opened with `gh` and the `ci` job is green.
- [ ] No secrets are needed for CI in Phase 1. There is no Anthropic key.
- [ ] Owner: make `ci` a required check.

**Phase 1 checkpoint** (as in KICKOFF). Then `/phase-done`.

---

## 3. Phase 2 — LLM features (detailed at 2.1, 2026-09-30)

Goal (KICKOFF): notes → tasks extraction with a review screen, an "Ask ActionDesk" assistant that uses tools, evals, and cost controls. Owner decisions for this phase: D-11 to D-15 and D-19 to D-21 (§6).

### 3.1 Streaming (spike result, 2.1)

Server Actions can stream, so R5 holds and no ADR is needed. The spike (throwaway branch, deleted) ran against `next dev` and a production build (`next start`); both gave the same results:

| Check | Result |
|---|---|
| a. Incremental delivery | Yes. The action resolves in ~120 ms, then events arrive 300 ms apart. It works for both an async generator and a `ReadableStream` return. |
| b. Auth during the stream | `getUser()` works before the first event. A write *after* the last event runs as the user: `owner_id default auth.uid()` resolved and RLS passed. |
| c. Blocking | No. A second action during a 9 s stream returned in ~100 ms. |
| d. Abort | Navigating away stops the generator and runs its `finally`. Code after the loop does **not** run. The server logs `The destination stream closed early` (harmless, but filter it in Sentry at 3.x). |
| d, corrected at 2.8 | **Not reliable.** With a real API stream, React stops reading but doesn't close the generator, so `finally` never ran and the aborted call wasn't logged at all (found by the security review plus a live check). Usage is now recorded by `usageRun()`, which uses Next's `after()` and runs once the response ends, whichever way it ends. |

What follows from this:
- **Pattern:** the action authenticates, validates input, then `return`s an async generator. The client reads it with `for await`.
- **Usage logging goes through `usageRun()`** (2.8): the generator's `finally` records it, and an `after()` callback records it if the client disconnected and `finally` never ran. Either path cancels the Anthropic request.
- **Not tested locally:** buffering on Vercel. Check it on the first preview deploy (3.x) with the extraction stream. If Vercel buffers, that's an ADR, not a workaround.

### 3.2 Data model

All through `/migrate`: a new migration file, RLS in the same file, table grants, and pgTAP tests for owner, other user and anon per policy.

**`llm_usage`** (2.3, D-19)
- Columns:
  - `id`, `user_id` (→ profiles, `on delete cascade`), `feature` (`extract` | `ask`; `digest` is added in Phase 3);
  - `model`, `input_tokens`, `output_tokens`, `cached_tokens` (all ints ≥ 0);
  - `cost_usd numeric(10,6)`, `outcome` (`ok` | `invalid_output` | `error` | `capped` | `aborted`), `latency_ms`, `request_id text null`, `created_at`.
- Policies and grants:
  - `select` own rows only. No insert, update or delete for `authenticated`, and nothing for `anon`.
  - Append-only, so a user can't erase usage to reset their cap.
- Functions:
  - `log_llm_usage(...)`: `security definer`, `set search_path = ''`. It sets `user_id = auth.uid()` itself and never takes it as an argument. It raises if unauthenticated. Check constraints reject negative or absurd values.
  - `llm_spend_today(tz text)`: the sum of `cost_usd` since local midnight in `tz`, for `auth.uid()`. Used by the cap (2.6).
- pgTAP:
  - A user can read their own rows and not another user's.
  - Direct insert is denied.
  - `log_llm_usage` can't write another user's row.
  - Anon is denied.

**`tasks` additions** (2.3)
- `source` enum (`manual` | `extraction` | `ask`), default `manual`.
- `source_quote text null`, check ≤ 500 chars. Displayed as plain text only.
- `assignee_text text null`, check ≤ 200 chars (D-13).
- Insert grants cover the new columns; `source_quote` and `source` aren't updatable.
- `src/lib/validation/task.ts` mirrors the checks.

**`app_admins`** (2.6, D-11)
- `app_admins(user_id pk → profiles)`. Each user can read only their own row, with no write grants; you insert your row by SQL.
- `is_app_admin()` is a `security definer` helper.
- An extra `llm_usage` select policy: `using (is_app_admin())`.

**`attachments`** (2.7, D-21)
- Columns: `id`, `owner_id default auth.uid()`, `storage_path`, `mime_type`, `size_bytes`, `created_at`. Select, insert and delete for the owner only.
- A private bucket `attachments`. `storage.objects` policies require `(storage.foldername(name))[1] = auth.uid()::text` for select, insert and delete.
- **Deletion:** the row and the object are deleted when the review is saved or discarded. Leftovers (a closed tab) go to a Phase 3 cron job (R-20).

### 3.3 `src/lib/llm/`

Every file imports `server-only`. `client.ts` is the only SDK import (R2).

| File | Responsibility |
|---|---|
| `client.ts` | Creates the SDK client from `ANTHROPIC_API_KEY`. Exports a narrow `LlmClient` interface (stream a message, get the final message) so tests and evals inject fakes or recordings. |
| `models.ts` | Model IDs per feature. Checked against Anthropic docs (claude-api skill) at 2.3 and again at 2.4, never guessed (rule 8, R-15). |
| `pricing.ts` | Per-model input, output and cache prices from the docs, with the date checked. `costUsd(model, usage)`. |
| `usage.ts` | `withUsage(feature, run)`: checks the cap (from 2.6), times the call, and **in `finally`** calls `log_llm_usage` with token counts from the API's `usage` field only (never from model text). Logs ids and counts only (rule 12). |
| `extract.ts` | The extraction pipeline (below). An async generator of `ExtractEvent`. |
| `ask.ts` | The Ask loop (below). An async generator of `AskEvent`. |
| `tools/*.ts` | One file per Ask tool: a Zod input schema and a `run(supabase, input)` that takes the request's user-scoped client. |
| `prompts/*.ts` | System prompts as versioned constants (`EXTRACT_PROMPT_V1`, …). The version is logged with usage. |

**Extraction pipeline** (`extract.ts`)
1. **Inputs:** the note text (or a PDF document block), `now`, the profile timezone, the user's non-archived projects as `{id, name}`, and `includeOthers` (D-13).
2. **Prompt:** the system prompt says the content inside `<note>` tags is data to extract from, never instructions. The user message holds the date and timezone, the project list and the note.
3. **Tool:** the model calls **`add_task` once per task**, with a strict JSON schema:
   - `title`, `assignee`;
   - `due_date` (YYYY-MM-DD, optional) and `due_time` (HH:mm, optional), in the user's local time (D-20);
   - `project_id` (uuid | null), `confidence` (0–1), `source_quote` (≤ 500).
   - Plain text replies are ignored.
4. **Per block:** as each `tool_use` block completes, it's Zod-parsed (`ExtractedTask`) and a valid one is yielded immediately, so the review screen fills while the model is still writing.
5. **Retry once:** invalid blocks go back in one follow-up turn, as `tool_result` with `is_error` and the Zod message. Blocks still invalid are dropped and counted (`invalid_output`).
6. **Post-checks:**
   - A `project_id` not in the user's list becomes null.
   - Exact duplicate titles are merged.
   - `due_date`/`due_time` are converted with `src/lib/time` (END_OF_DAY, the spring-forward gap rule).

**Ask loop** (`ask.ts`)
- **Input:** the chat history (text turns only) and the new question.
- **Loop:** at most 5 tool rounds per question, then a forced final answer.
- **Events:**
  - `text` (a delta);
  - `tool_call` (name and a short argument summary, for the UI chip);
  - `proposal` (a validated `create_task` proposal with an id);
  - `done` or `error`.
- **Tool results** are JSON of trimmed fields, wrapped as data. Task titles are other people's text (R-13).

**Tools** (2.5, ADR-0003)

| Tool | Input (Zod) | Query (user client, so RLS applies) |
|---|---|---|
| `search_tasks` | `query` ≤ 200, `status?`, `project_id?` | `tasks` with `ilike` on the title, limit 20 |
| `list_overdue` | none | `due_at < now`, not done, limit 50, using the injected `now` |
| `get_project_summary` | `project_id` uuid | the project row plus task counts by status. Not found or invisible gives the same answer |
| `create_task` | the same fields as the task form | **Writes nothing.** Returns a `proposal` event. The user's click calls `confirmCreateTask` |

### 3.4 Validation (`src/lib/validation/`)

- **`extraction.ts`:** `ExtractedTask` and `ReviewedTask` (what the review screen sends back). `toTaskInput(reviewed, tz)` maps a reviewed task onto the existing task create schema, so saved tasks pass exactly the checks that manual ones do.
- **`ask.ts`:**
  - the tool input schemas;
  - `ChatTurn` = `{role: "user" | "assistant", text ≤ 4000}`, at most 20 turns;
  - `CreateTaskProposal`.
- **`attachment.ts`:** size and type rules, and the magic-byte signatures.

### 3.5 Routes, actions and UI

| Path | What |
|---|---|
| `(app)/capture/page.tsx` | Paste box and file picker. The review list is client state only (D-14). |
| `(app)/capture/actions.ts` | `extractTasks(text \| attachmentId, includeOthers)` streams `ExtractEvent`s. `saveReviewedTasks(rows)` re-validates every row, inserts with `source = 'extraction'`, and deletes the attachment. `uploadAttachment(formData)`, `discardAttachment(id)`. |
| `src/components/capture/` | `review-list.tsx`: per row edit / reject / accept, a low-confidence flag (< 0.6), and `source_quote` shown as text. "Save accepted" posts once. |
| `src/components/ask/` | A slide-over panel in the `(app)` layout. Plain text with line breaks (D-15), tool chips, and a proposal card with Confirm and Dismiss. |
| `(app)/ask/actions.ts` | `askStream(history, question)` streams `AskEvent`s. `confirmCreateTask(proposal)` re-validates, then creates the task as the user with `source = 'ask'`. |
| `(app)/admin/usage/page.tsx` | Usage by day and feature, with a total cost. RLS gates the data (D-11); a UI check only gives a clearer "not an admin" page. |

**Every action** calls `getUser()`, validates with Zod, and returns an `ActionResult`, or an event stream whose first event is an `error` on failure.

**Cap-exceeded errors** read: "You've reached today's AI limit. It resets at midnight."

### 3.6 Attachments (2.7)

- **Size:** ≤ 4 MB (D-22; was 10 MB), checked on the server from the uploaded bytes, not a header.
- **Type** is decided by magic bytes. The filename and the browser's MIME type are ignored:
  - PDF: `%PDF-`;
  - .docx: `PK\x03\x04` plus a `word/document.xml` entry;
  - .txt/.vtt/.srt: valid UTF-8 with no NUL bytes. VTT also starts with `WEBVTT`.
- **Text extraction:**
  - PDFs go to Claude as a `document` block, so hidden text is still just text in `<note>`.
  - .docx uses `mammoth`, a dependency to ask about at 2.7.
  - VTT/SRT use a small parser with unit tests, which strips timestamps and keeps speaker names.
- **Storage path:** `{uid}/{attachment_id}.{ext}`, built on the server, with `ext` taken from the detected type.

### 3.7 Evals (2.2)

- **Cases:** `evals/extraction/<case>/`, 15–20 of them, written by the owner (KICKOFF 2.2), plus 3 attachment cases at 2.7. Each case has:
  - `case.json`: `{now, timezone, userName, projects: [{id, name}], includeOthers}` (`userName` from `profiles.display_name`, so the model knows which tasks are the user's);
  - `input.txt` (or `input.pdf`);
  - `expected.json`: `[{title, assignee, due_date | null, due_time | null, project_id | null}]`, in local time like the model (D-20; changed at 2.2 so cases are written without UTC arithmetic);
  - `recorded.json`: the raw API responses from the last live run.
- **Runner:** `evals/extraction.eval.ts` in the existing Vitest `eval` project (R-6). Loader, scorer and report live in `evals/lib/`, tested in the unit project. It takes an `Extractor` function; until 2.3 every case shows "no recording".
  - **Recorded mode (default):** replays `recorded.json` through the real `extract.ts` via a fake `LlmClient`. Deterministic, with no key.
  - **Live mode** (`EVAL_LIVE=1 npm run eval`): calls the API, rewrites `recorded.json`, and logs usage.
- **Matching:** greedy one-to-one pairing of extracted to expected tasks by title similarity: the share of the shorter title's words found in the other, ≥ 0.6. (Changed at 2.3 from Jaccard ≥ 0.5, which failed to pair correct but longer titles.)
- **Scores per case:**
  - title (matched pairs);
  - assignee (case-insensitive);
  - due (exact UTC instant after conversion);
  - project (exact);
  - precision and recall.
  - A case expecting no tasks scores 1 only if nothing is extracted.
- **Output:** a per-case table plus an overall score. Each field (title, assignee, due, project) gets an F1, where a field counts as correct only on a matched pair. A case's score is the mean of its four F1s, and the overall score is the mean over cases. An extractor error scores 0. Scores go into `docs/learnings.md` per iteration.
- **CI:** `ci.yml` gains an `npm run eval` step (recorded mode) at 2.2.

### 3.8 Where LLM output crosses a trust boundary

| # | Boundary | Control | Test |
|---|---|---|---|
| 1 | Pasted text and files → prompt | `<note>` tags; the system prompt says it's data; hidden PDF text gets the same treatment | Injection eval cases (2.2, 2.7) |
| 2 | Extraction output → review UI | Strict tool schema, Zod per block, one retry, then drop and count; rendered as text only, never `dangerouslySetInnerHTML` | Unit tests with malformed recorded responses |
| 3 | Review UI → DB | `saveReviewedTasks` re-validates with the task schema; `owner_id` from `getUser()`; project checked by the FK and RLS | Unit + e2e |
| 4 | Ask tool arguments → queries | Zod per tool; user-scoped client only (ADR-0003); fixed query shapes, no model-built filters | **db test: user B's client on user A's project gets nothing** (2.5) |
| 5 | Ask `create_task` → DB | Proposal only; `confirmCreateTask` re-validates; no write without a click | Unit: the tool never touches the DB. e2e: nothing saved until Confirm |
| 6 | Assistant text → chat UI | Plain text with line breaks (D-15) | e2e: `<b>` in a reply renders literally |
| 7 | Usage numbers → cap | Tokens from the API's `usage` field; cost from `pricing.ts` | Unit |
| 8 | Chat history from the client → model | Text turns only, length and count capped; tool results never accepted from the client (tools re-run) | Unit on `ChatTurn` |
| 9 | Proposal from the client → `confirmCreateTask` | Treated as user input: same schema as the task form; `owner_id` from `getUser()` | Unit |
| 10 | DB text in tool results → model | Wrapped as data; write tools stay proposal-only (R-13) | Injection case at 2.8 |
| 11 | Upload → storage and parser | Magic-byte type, server-side size, server-built path, private bucket | Unit + e2e (oversized, wrong type) |

### 3.9 Steps and acceptance

KICKOFF order, with three changes: usage logging and the `tasks` columns move to 2.3 (D-19), and CI runs evals from 2.2.

**2.2 Evals first** (friction exercise C; the owner writes the cases)
- [ ] 15–20 cases covering KICKOFF's hard cases (relative dates, none, duplicates, others' tasks, Taglish, injection).
- [ ] `npm run eval` prints a per-case table and an overall score. Recorded mode is deterministic, with no key.
- [ ] The runner is tested against a hand-made recording: a perfect case scores 1, and a wrong date lowers the score.
- [ ] `ci.yml` runs the eval.

**2.3 Extraction** (ask first: `@anthropic-ai/sdk`)
- [ ] Migrations: `llm_usage` + `log_llm_usage` + `llm_spend_today`, and the `tasks` columns, with pgTAP.
- [ ] `models.ts` and `pricing.ts` checked against the docs, with the date recorded.
- [ ] Per-block validation, one retry, graceful failure. Every call is logged, aborted ones included.
- [ ] The review screen streams rows, flags low confidence, and supports edit / reject / accept. Only accepted rows are saved.
- [ ] e2e with a fake `LlmClient` (the env `LLM_FAKE=1`, honored only when `NODE_ENV !== 'production'`): paste → rows appear → accept two → saved with the right `due_at` in the profile timezone.
- [ ] A live eval score is recorded in `docs/learnings.md`.

**2.4 Model comparison** (friction exercise D)
- [ ] A live eval with a Haiku-class and a Sonnet-class model (IDs from the docs): score, p50 latency and cost per case.
- [ ] A recommendation in `docs/learnings.md`; `models.ts` updated.

**2.5 Ask ActionDesk**
- [ ] The four tools above, a streaming panel, and tool chips.
- [ ] **A db test where user B's client calls each tool against user A's project and gets nothing.** pgTAP for any new definer function.
- [ ] `create_task` saves nothing until Confirm (unit + e2e).
- [ ] Friction exercise E noted: did the tools use the user client unprompted?

**2.6 Cost controls**
- [ ] The cap: `LLM_DAILY_CAP_USD`, checked with `llm_spend_today` before each call, with a friendly error and outcome `capped`. R-14: accept a small overshoot (decided here).
- [ ] Prompt caching on the system prompt and tools. `cached_tokens` > 0 on a second call, or R-19 recorded with the measured prompt size.
- [ ] `app_admins` + `is_app_admin()`. The admin page is gated by RLS; a non-admin sees no rows (pgTAP).

**2.7 Attachments** (ask first: `mammoth`)
- [ ] The bucket and table with policies, and a pgTAP/db test showing user B can't read user A's object.
- [ ] Oversized, wrong-type (renamed .exe → .pdf) and empty files are rejected on the server (unit + e2e).
- [ ] The file is deleted after save or discard.
- [ ] 3 attachment eval cases, including the hidden white-text PDF.

**2.8 Injection hardening**
- [ ] The injection cases run through Extract and Ask. No instruction from content is followed, and no write happens without a click.
- [ ] A security-reviewer report on Phase 2 is attached to the PR.
- [ ] `/phase-done`.

**Dependencies (ask when needed):** `@anthropic-ai/sdk` (2.3), `mammoth` (2.7). No PDF library, since PDFs go to Claude natively. The VTT/SRT parser is hand-written.

**Env (names only in `.env.local.example`):** `ANTHROPIC_API_KEY` (already listed), `LLM_DAILY_CAP_USD` (2.6), `LLM_FAKE` (dev and e2e only; ignored in production).

---

## 4. Phase 3 — Workspaces, background jobs, production (detailed at 3.1, 2026-09-30)

Goal (KICKOFF): workspaces with roles, safe migration of existing data, realtime updates, weekly AI digest, MFA-protected destructive actions, performance at 100k tasks, observability, production deploy, and an incident drill. Owner decisions for this phase: D-16 to D-18 and D-23 to D-25 (§6).

### 4.1 Data model
- **`workspaces`:** `id`, `name` (1–100), `created_by → profiles`, `created_at`, `updated_at`, `deleted_at` (D-17).
- **`workspace_members`:** PK `(workspace_id, user_id)`, `role workspace_role` (`owner` | `member` | `viewer`), `created_at`. Plus a trigger that refuses to remove or demote the **last owner**.
- **`invites`** (built at 3.3):
  - `id`, `workspace_id`, `email` (lowercased), `role` (member | viewer; owners are promoted, not invited),
  - `token_hash bytea` (sha256 of 32 random bytes; only the hash is stored),
  - `invited_by`, `created_at`, `expires_at` (7 days), `accepted_at`, `accepted_by`.
- **`projects`** gets `workspace_id not null`:
  - `unique (id, workspace_id)` replaces `unique (id, owner_id)`;
  - the name index becomes `(workspace_id, lower(name))`.
- **`tasks`** gets `workspace_id not null`:
  - the composite FK becomes `(project_id, workspace_id) → projects (id, workspace_id)`;
  - `assignee_id → profiles`, null, checked by a trigger to be a member of the task's workspace.
- **`llm_usage`** gets `workspace_id null`: null for Ask and history, set for extraction when saved. It's for reporting only (D-25).
- **`owner_id` stays** on `projects` and `tasks`, meaning *creator*. It isn't renamed or dropped: that keeps rollback a policy-only change and keeps the history. `attachments` are unchanged (D-24).

### 4.2 Membership helpers and recursion
- `role_rank(workspace_role) → int` (viewer 1, member 2, owner 3), immutable.
- `my_workspaces(min_role) → setof uuid`: `security definer`, `stable`, `search_path = ''`. It returns the workspace ids where `auth.uid()` has at least `min_role`, excluding soft-deleted workspaces.
- **Policies use the set form:** `using (workspace_id in (select public.my_workspaces('viewer')))`.
  - Postgres evaluates the subquery once per statement (an initplan), not once per row. That's the performance concern KICKOFF 3.7 names, designed in rather than fixed later. 3.7 still measures it.
- **Recursion:** policies on `workspace_members` would normally query `workspace_members`, which would invoke its own policy again. `my_workspaces()` is `security definer`, owned by `postgres`, so its read of `workspace_members` bypasses RLS and doesn't recurse. No policy on any table queries `workspace_members` directly; they all go through the helper.
  - pgTAP checks this: a select on `workspace_members` as a user doesn't raise `42P17` (infinite recursion).
- `is_member(ws, min_role) → bool`, a scalar wrapper for single-row checks in functions (`accept_invite`, the digest).
- **Profiles:** members must see co-members' names (assignee pickers, member list). A new select policy: own row, **or** `id in (select public.my_coworkers())`, a definer function returning the user ids that share a workspace with the caller.

### 4.3 Role matrix → policies
| Table | select | insert | update | delete |
|---|---|---|---|---|
| workspaces | member of any role | anyone, via `create_workspace(name)` (definer; also adds the owner row) | owner | owner + aal2 (3.5); soft delete |
| workspace_members | members of the same workspace | owner (at 3.3, only via `accept_invite` or `add_member`) | owner (role change; last-owner trigger) | owner + aal2 (3.5), or self (leave; last-owner trigger) |
| invites | owner | owner | none | owner (revoke) |
| projects | viewer+ | member+, `owner_id = auth.uid()` | member+ | member+ |
| tasks | viewer+ | member+, `owner_id = auth.uid()` | member+ | member+ |
| llm_usage | own rows, plus workspace owners for rows in their workspace, plus app admins | none (log function) | none | none |

- Column grants stay as they are, plus `insert (workspace_id)` on projects and tasks.
- `workspace_id` isn't updatable: moving a task between workspaces is out of scope.

### 4.4 Migration sequence (3.2), three new files, each atomic
1. **`workspaces_core`:**
   - enum, tables, RLS enabled, grants and policies;
   - `role_rank`, `my_workspaces`, `is_member`, `my_coworkers`, `create_workspace`;
   - the last-owner trigger.
   - Nothing existing changes yet.
2. **`workspaces_backfill`:** one transaction, which is the risky one.
   1. **Snapshot counts** into a temp table: profiles, projects, tasks (and per-owner counts), llm_usage.
   2. **Insert one "Personal" workspace per profile**, plus its owner membership. The mapping goes through a temp table `(user_id, workspace_id)`.
   3. **Add `workspace_id` as nullable** to projects, tasks and llm_usage. Backfill it through the mapping from `owner_id` (llm_usage from `user_id`), then set projects and tasks `not null`.
   4. **Swap the keys:** the unique `(id, workspace_id)`, the composite FK and the name index. The old ones are dropped only after the new ones exist.
   5. **Drop the `… own` policies on projects and tasks** and create the membership policies. This happens in the same transaction, so there's no window with no policies.
   6. **`tasks_before_write`:** the series check compares `workspace_id`, not `owner_id`.
   7. **`complete_task()`:** the next occurrence copies `workspace_id` and `assignee_id`. The outline missed this; without it every recurring completion fails `not null`.
   8. **`handle_new_user()`** also creates the Personal workspace and owner membership.
   9. **Self-check:** `DO` blocks raise, aborting the whole migration, if:
      - any count differs from the snapshot,
      - any row has a null `workspace_id`,
      - any project and task pair lands in different workspaces,
      - any profile has no owner membership.

      This runs in prod too.
3. **`llm_usage_workspace`:** the `log_llm_usage` overload gains `p_workspace_id` (checked with `is_member`), and the owner-reads-workspace-usage policy is added.

**Rollback:**
- **Before merge:** `supabase db reset` locally.
- **In prod:**
  - take a snapshot or backup before `db push` (a step in docs/deploy.md);
  - if it goes wrong after deploy, a **forward-fix** migration restores the `… own` policies. That works because `owner_id` was kept and never changed. Workspace tables can then be left in place, unused.
  - That revert migration is written and tested locally at 3.2 but **not committed** unless needed. Its SQL goes in docs/deploy.md.

**Rehearsal (3.2):**
- a seed script (`supabase/seed/phase3-rehearsal.sql`, local only): 2 users, 3 projects each, recurring and one-off tasks, completed series, llm_usage rows;
- `supabase db reset --version <before>` → seed → `migration up`;
- pgTAP 010–012 then prove the counts, ownership and the role matrix.

### 4.5 Code paths that change (3.2)
- **New:**
  - `src/lib/workspace/current.ts`: `getCurrentWorkspace(supabase)` reads the `ws` cookie, confirms membership with an RLS select, and falls back to Personal. It returns `{ id, name, role }`.
  - `setWorkspace` Server Action, which validates membership before setting the cookie.
- **`(app)/layout.tsx`:** a workspace switcher, and a "view only" badge for viewers.
- **Projects and tasks:**
  - Pages filter lists by the current workspace. RLS alone would show the union of all the user's workspaces.
  - Creates set `workspace_id`.
  - Updates and deletes by id rely on RLS: `42501` or 0 rows maps to "You can view this workspace but not edit it."
  - Viewers get read-only UI (hidden forms and row actions).
  - Detail pages show the row's own workspace.
- **Capture:** the project list and the saved tasks use the current workspace; viewers can't capture. Attachments are unchanged (D-24).
- **Ask:**
  - `ToolContext` gains `workspaceId`, and every tool query adds `.eq("workspace_id", ws)` on top of RLS.
  - `create_task` proposals carry the workspace, and `confirmCreateTask` re-checks it.
  - The context text lists the current workspace's projects.
- **Usage:** extraction logs `workspace_id`. Admin usage is unchanged.
- **Types:** regenerated. pgTAP 002, 003 and 006 are rewritten for membership, since tests are editable apart from 000.
- **e2e:** `signInAsNewUser` works unchanged, since a Personal workspace is created. A new `e2e/workspaces.spec.ts` covers the switcher and viewer read-only.

### 4.6 Remaining steps (acceptance lists)
- **3.3 invites:**
  - `create_invite` (owner) returns the token once, and the link is shared (D-18).
  - `accept_invite(token)` (definer) checks: hash match, not expired, not accepted, and email equal to `auth.jwt()->>'email'` (D-16).
  - Two-user e2e; expired and reused tokens are rejected.
- **3.4 Realtime:** Broadcast from DB triggers on `workspace:<id>` private channels, with RLS on `realtime.messages` via `my_workspaces()` (R-12). The Playwright cases stay as in the outline below.
- **3.5 MFA:** as in the outline below. The aal2 check goes in the delete policies from the table in 4.3.
- **3.6 digest:**
  - As in the outline below; the email provider is asked first.
  - Per-workspace digest uses `is_member` and `workspace_id` filters with the admin client in the Edge Function (ADR-0003).
  - Adds Ask injection cases for other members' titles and project names (R-26).
- **3.7 to 3.12:** as in the outline below. At 3.7, the numbers for `my_workspaces()` initplans vs per-row `is_member()` are the first measurement.

#### Outline for 3.3–3.12 (kept from the original plan; the notes above refine it)

| Step | Must be true |
|---|---|
| 3.3 Invites | Owner invites by email; recipient signs in with Google and accepts; expired and reused invites are rejected; e2e test with two users; whether an email is sent is D-18 |
| 3.4 Realtime | Recommendation: Realtime **Broadcast** from DB triggers on private per-workspace channels, authorized by RLS on `realtime.messages` using `is_member()`, rather than `postgres_changes` (R-12). Two-context Playwright test: an update seen in under 2 s; an outsider sees nothing; reconnect after sleep; no duplicates from the optimistic update plus the echo (dedupe by id + `updated_at`) |
| 3.5 MFA | TOTP enrol, verify and unenrol in Settings → Security; enable `[auth.mfa.totp]` in config.toml; pgTAP: an aal1 session can't delete a workspace or remove a member |
| 3.6 Digest | Edge Function (admin client allowed by ADR-0003; every query filtered by `workspace_id`) plus hourly Cron. It selects workspaces whose owner's local time is Monday 08:00–08:59 with no `sent` digest run. Claude output is Zod-validated in Deno (R-7); empty weeks are skipped; a timeout resumes via `digest_runs`; usage is logged. The "send test digest now" button is a Server Action that checks the owner and invokes the function with the user's JWT. Email provider: ask first |
| 3.7 Performance | The seed is SQL (`generate_series`), not an admin-client script. EXPLAIN ANALYZE runs as an authenticated user with the JWT claims set. k6 covers the task list and Ask. Indexes and rewrites only with before/after numbers (rule 13) |
| 3.8 Observability | Sentry for Next (client and server) and Edge Functions, with source maps and release tags; the logger gains request, user and workspace ids, feature and latency; LLM calls log metadata only; `/api/health` |
| 3.9, 3.11 | Owner-driven drills; nothing to plan beyond the regression-test expectation |
| 3.10 Deploy | docs/deploy.md runbook; every prod-affecting command is confirmed; prod disables email/password auth if D-8 enables it locally |
| 3.12 | security-reviewer on the whole repo, a written review, then `/phase-done` |

---

## 5. Architecture fit

Nothing in this plan needs a rule change right now, so no ADR is proposed yet. Two points could turn into ADRs, and I'll stop and run `/propose-adr` if either happens:

1. **Streaming (Phase 2):** if Server Actions can't stream extraction and Ask responses, a route handler would be doing the `llm_usage` writes, which conflicts with R5 (R-5).
2. **Shared schemas between Next.js and Edge Functions (Phase 3):** ADR-0002 already expects "a deliberate shared package later". If the digest needs `src/lib/validation` or prompts from `src/lib/llm` inside Deno, that is a new cross-boundary import and needs a decision (R-7).

The plan also relies on some **interpretations**. They don't change rules, but please confirm them:
- `security definer` functions other than `is_member()`: `handle_new_user()` (Phase 1), `log_llm_usage()` (Phase 2), `accept_invite()` (Phase 3). Each gets its own pgTAP tests and `set search_path = ''`.
- Writing to `llm_usage` inside the same Server Action that makes the LLM call counts as part of that mutation.
- The admin usage page uses RLS (`is_app_admin()`), not the service role. This keeps `src/lib/admin/**` empty and avoids the admin client in a user request path entirely.

---

## 6. Decisions (owner)

On 2026-09-29 the owner accepted every recommendation, and chose to cut the 1.6 acceptance list for D-2.

| # | Decision | Recommendation | Decision (2026-09-29) |
|---|---|---|---|
| D-1 | Phase 1 rows keyed by `owner_id` and migrated to `workspace_id` in Phase 3, or `workspace_id` from day one | `owner_id` now, because KICKOFF 3.1 depends on doing that migration | Accepted |
| D-2 | This plan specifies `projects` in detail, which removes the point of exercise A (1.6's vague prompt), since Claude reads this file every session | Keep only the schema and RLS (needed by tasks); cut the 1.6 acceptance list before approving if you want the exercise to stay honest | Cut the 1.6 acceptance list; keep only the schema and RLS |
| D-3 | What happens to tasks when a project is deleted | Archive is the normal path. Hard delete sets tasks' `project_id` to null. The UI warns with a task count. | Accepted |
| D-4 | Priority levels | `low` / `normal` / `high` / `urgent` enum | Accepted |
| D-5 | Recurrence anchor: the profile timezone at completion time, or the task's own `recurrence_tz` fixed at creation | Store `recurrence_tz`, so moving to Manila doesn't turn your 9am Pacific standup into 9am Manila. Display still follows the profile. | Accepted |
| D-6 | Week start and the "This week" definition; allow raw RRULE entry | Monday start (ISO); presets only | Accepted |
| D-7 | Next occurrence based on the previous `due_at` (schedule-based) or on the completion date | Schedule-based: the next occurrence after the previous `due_at` that is also after now, so overdue recurring tasks don't pile up | Accepted |
| D-8 | How e2e tests sign in without Google | Enable email/password **locally and in CI only**. Playwright signs in seeded users with supabase-js and sets the cookies. Prod keeps Google only. | Accepted |
| D-9 | 1.4 needs a migration on `main` for violation 4 | Run 1.4 after the 1.5 PR is merged, or merge a trivial first migration in 1.3 | Accepted: run 1.4 after the 1.5 PR is merged |
| D-10 | `server-only` as a runtime or dev dependency | Runtime (`dependencies`), since it runs in the production bundle | Accepted |
| D-11 | Who counts as "admin" for the usage page | `app_admins` table plus `is_app_admin()`, with the row inserted by you via SQL | Accepted |
| D-12 | How `llm_usage` rows are written | `log_llm_usage()` definer function; no direct insert policy | Accepted |
| D-13 | Extraction's `owner` field in single-user Phase 2 | Store it as `assignee_text`; extract only tasks for the user by default, with an option to include others | Accepted |
| D-14 | Persist extraction drafts or the raw pasted text | No: ephemeral review, only accepted tasks are saved, plus `source_quote` | Accepted |
| D-15 | Ask assistant: markdown rendering, and whether chat history is persisted | Plain text with line breaks; no persistence in Phase 2 | Accepted |
| D-16 | Invite acceptance mechanism | `accept_invite(token)` definer function; the token is hashed at rest; the email must match | Accepted |
| D-17 | Soft or hard delete of workspaces | Soft delete (`deleted_at`) with a purge job later. Hard delete behind aal2 is acceptable if you prefer it. | Accepted |
| D-18 | Invites: send an email, or share a link | Share a link in 3.3; email once the provider is chosen in 3.6 | Accepted |
| D-19 | When `llm_usage` logging starts (KICKOFF puts it at 2.6) | 2.3, so every live call is logged; 2.6 keeps the cap, caching and admin page | Accepted (2026-09-30) |
| D-20 | Due-date format from extraction | Local `due_date` + optional `due_time`, converted by `src/lib/time` (not ISO with offset, which models get wrong across DST) | Accepted (2026-09-30) |
| D-21 | Retention of uploaded files | Delete when the review is saved or discarded; Phase 3 cron removes leftovers; only `source_quote` stays | Accepted (2026-09-30) |
| D-22 | Uploads over Vercel's 4.5 MB request body limit (R-22) | Option A (proposed ADR 0007: browser uploads to a signed Storage URL) or Option B (a 4 MB limit, no architecture change) | Option B, 4 MB (2026-09-30). ADR 0007 was not adopted; revisit if users hit the limit |
| D-23 | How the current workspace is chosen | A header switcher stored in a cookie, validated against membership on every request, defaulting to Personal; URLs unchanged | Accepted (2026-09-30) |
| D-24 | Move attachments to workspace storage folders (outline step 6) | Keep them per-user: they're short-lived review inputs (D-21); saved tasks go into the current workspace | Accepted (2026-09-30); resolves R-16 |
| D-25 | AI cap per user or per workspace | Per user for now (rolling 24 h); `llm_usage.workspace_id` for reporting; revisit at 3.6 | Accepted (2026-09-30) |

---

## 7. Risks and guardrail gaps

Items marked **(owner)** involve locked files that I can't and won't change.

| # | Risk | Mitigation |
|---|---|---|
| R-1 **(owner)** | `.claude/hooks/guard.sh` only blocks `rm -rf`. It doesn't block edits to committed migrations, which ADR-0005 says it does. architecture.md §6 names `.claude/hooks/protect-migrations.sh`, which doesn't exist. | CI (`check.sh`) still catches it. Consider extending guard.sh and fixing the §6 name. |
| R-2 **(owner)** | architecture.md §6 lists "ESLint `no-restricted-imports`" for R2 and R3, but there is no ESLint config, and one created at 1.3 would be editable by Claude. dependency-cruiser is the real enforcement. | Either add the ESLint config to the locked paths after 1.3, or drop that row from §6. |
| R-3 **(owner)** | dependency-cruiser R6 only covers `src/components/`. A `"use client"` file under `src/app/` that imports `src/lib/llm/` is caught only by the `server-only` build error, and only for files that import `server-only` directly. | Keep every server-only module importing `server-only` (the required rule enforces this for llm and admin). Put client components in `src/components/`. |
| R-4 | ~~CODEOWNERS placeholder username~~ | Resolved in 1.2: `@randygetc`. |
| R-5 | ~~Streaming vs R5 (§5)~~ | Resolved at 2.1: Server Actions stream (§3.1). Log usage in `finally`. |
| R-6 | `server-only` throws outside the `react-server` condition, so Vitest and `npm run eval` can't import `src/lib/llm` directly. | Alias `server-only` to a no-op in the Vitest config; run evals through Vitest or with `--conditions=react-server`. Never remove the import to make a test pass. |
| R-7 | The digest Edge Function (Deno) needs Zod schemas and prompts that live in `src/lib/`. | Duplicate a small digest schema in `supabase/functions/_shared/` for now; ADR if sharing is wanted. |
| R-8 | Recurrence with RRULE libraries: `rrule.js` handles time zones poorly (TZID and floating times), so DST bugs are likely. | Expand in local wall-clock time and then convert with a proper tz library. The 1.8 tests are the gate. Choose the library at 1.7 (ask first). |
| R-9 | Rule 13 (no index without measurements) vs normal practice of indexing foreign keys. Phase 1 will have no FK or `due_at` indexes. | Accept it: data is tiny until 3.7, which measures and adds them. Flag if you'd rather allow FK indexes up front. |
| R-10 | `complete_task` race conditions and double submits. | `unique (series_id, due_at)` plus an idempotent function, with a test that runs it twice concurrently. |
| R-11 | `supabase/config.toml` has `additional_redirect_urls = ["https://127.0.0.1:3000"]` (https, no path), and Google isn't configured. | Fix both in 1.5; the redirect must allow `http://127.0.0.1:3000/auth/callback`. |
| R-12 | Realtime `postgres_changes` checks RLS per subscriber per change (slow at scale), and DELETE events aren't RLS-filtered in the same way. | Use Broadcast with private channels and RLS on `realtime.messages`, or soft deletes. Decide at 3.1. |
| R-13 | ~~Prompt injection through stored task titles~~ | Covered at 2.8 by `evals/ask-injection.eval.ts`, a gate in CI. Malicious titles in tool results caused no writes, no proposals, and no hijacked replies; the model quoted them as data. Re-check at 3.6 when titles come from other members. |
| R-14 **(owner)** | Parallel requests overshoot the cap. The security review showed one call can cost far more than "a few cents" (a PDF, or 6 Ask rounds). | Per-call cost is now bounded (PDF token budget; aborted calls charged). The real fix, to decide: reserve an estimated cost before each call with a definer function, or allow one in-flight call per user. |
| R-15 | Anthropic model IDs and prices change. | `models.ts` and `pricing.ts` are the only places they appear; check the docs at 2.3 and 2.4 (rule 8). |
| R-16 | ~~Storage path migration to per-workspace paths~~ | Resolved by D-24: attachments stay per-user, so there's no path migration. |
| R-17 | Library versions have moved on (Next 16 `proxy.ts`, Supabase's new publishable and secret API keys, Zod 4, Tailwind 4). | Verify against current docs at 1.3; record choices in docs/conventions.md. |
| R-18 | Vercel may buffer streamed Server Action responses; the 2.1 spike ran only locally (dev and `next start`). | Check with the extraction stream on the first preview deploy (3.x). If it buffers, propose an ADR; don't work around it. |
| R-19 | ~~System prompt below the minimum cacheable length~~ | Measured at 2.6: the extraction prefix is 1,407 tokens (Sonnet 5.5's minimum is 512), with 18 of 19 eval calls reading it. Ask hits the cache as well. Re-check if the model changes (Haiku's minimum is 4,096). |
| R-20 | An attachment is orphaned if the review tab is closed before save or discard (D-21). | Phase 3 cron deletes attachments older than 24 h; until then, a documented cleanup query. |
| R-21 | `LLM_FAKE` (e2e fake model) must never be active in production. | Honored only when `NODE_ENV !== 'production'`, with a unit test; not set in Vercel. |
| R-22 | ~~Vercel's 4.5 MB request body cap vs 10 MB uploads~~ | Resolved by D-22: attachments are capped at 4 MB (app, table check and bucket). |
| R-23 **(owner)** | Users can write fake usage rows for themselves with `log_llm_usage` (review #6). They can't lower their cap, but they can add noise to the admin report. The report is now aggregated in SQL, so it can't be truncated. | Move usage writes off the user's session to a server-only path. That uses the admin client, so it needs an ADR (R3). |
| R-24 | ~~The 11 MB body limit applies to all actions~~ | Resolved with D-22: the Server Action limit is 4.5 MB (a 4 MB file plus overhead), and the proxy override is gone. |
| R-25 | A client can forge earlier assistant turns in its own chat history (review #10). The impact stays with that user: tools re-run and writes are proposal-only. | Accepted for Phase 2. Keep history server-side if chat persistence is added. |
| R-26 | Project names and the display name go into prompts outside the note tag (review #11). This is harmless while each user sees only their own data. | Phase 3 (workspaces): wrap every member-written list in data framing, and add Ask injection cases for other members' titles and project names. |
| R-27 | The backfill migration (§4.4 step 2) runs in one transaction over all rows in prod. | Fine at current size; time it on the 3.7 seed before deploying. |
| R-28 | The current-workspace cookie is set by the client. | It's only a preference: RLS authorizes every read and write, and `getCurrentWorkspace` ignores a workspace the user isn't a member of. Add a test at 3.2. |
| R-29 | Co-members can read each other's `display_name`. | Mention it in the privacy notes at 3.10. |
