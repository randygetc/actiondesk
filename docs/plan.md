# Plan

Written by Claude Code in step 1.1. Editable. Must conform to docs/architecture.md.

- **Last updated:** 2026-09-30 (Phase 1 done)
- **Sources:** CLAUDE.md, docs/architecture.md, docs/adr/0001–0005, docs/KICKOFF.md, guardrails/, .claude/
- **Scope:** Phase 1 is in full detail. Phases 2 and 3 are outlined and get detailed in steps 2.1 and 3.1.
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
| 2.x | LLM features | outline only |
| 3.x | Workspaces, jobs, prod | outline only |

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

## 3. Phase 2 — LLM features (outline; detailed at 2.1)

### Data model additions

- **`llm_usage`**:
  - columns: `id`, `user_id` (→ profiles), `feature` (`extract` | `ask` | `digest`), `model`, `input_tokens`, `output_tokens`, `cached_tokens`, `cost_usd numeric(10,6)`, `outcome` (`ok` | `invalid_output` | `error` | `capped`), `latency_ms`, `created_at`.
  - It is append-only: no update or delete policies, so a user can't erase usage to reset their cap.
  - Inserts go through a `log_llm_usage(...)` function rather than an open insert policy, so the browser can't write rows directly (D-12).
- **`tasks`** gains:
  - `source` (`manual` | `extraction` | `ask`), default `manual`;
  - `source_quote text null` (≤ 500 chars; displayed as plain text only);
  - `assignee_text text null` for the free-text owner from extraction (D-13).
- **`attachments`**: `id`, `owner_id`, `storage_path`, `mime_type`, `size_bytes`, `created_at`. Storage bucket `attachments` is private, with the object path `{owner_id}/{attachment_id}.{ext}`. `storage.objects` policies match the table: the first path segment must equal `auth.uid()`.
- **Admin role.** The usage page needs one (D-11). The recommended form is an `app_admins(user_id)` table, readable only by its own row, plus an `is_app_admin()` helper used in an extra `llm_usage` select policy. This keeps the admin page on the user client with no service role.
- **Daily cap:**
  - The default comes from the env variable `LLM_DAILY_CAP_USD`.
  - It is checked in `src/lib/llm/usage.ts` before every call by summing today's `llm_usage` rows in the user's timezone.
  - In Phase 3 it moves to per-workspace settings.

### Routes and modules

- `(app)/capture/page.tsx`: paste text or upload a file.
- The review screen is client state on the same route. Extracted drafts are not persisted; only accepted tasks are saved (D-14).
- `(app)/capture/actions.ts`: `extractTasks`, `saveReviewedTasks`, `uploadAttachment`.
- The Ask panel is a slide-over in the `(app)` layout. Its actions are `askStream` and `confirmCreateTask`.
- `(app)/admin/usage/page.tsx`: gated by `is_app_admin()` in RLS, with a UI check only for a clearer error.
- `src/lib/llm/`:
  - `client.ts`: the only SDK import;
  - `models.ts`: model IDs, verified against Anthropic docs at 2.3 (rule 8);
  - `extract.ts`, `ask.ts`, `tools/*.ts`;
  - `pricing.ts`, `usage.ts`, `prompts/*`.
- `src/lib/validation/extraction.ts` holds `ExtractedTask`: title, owner, due_at (ISO with offset), project_id (uuid | null), confidence 0–1, source_quote. The `project_id` must also be in the user's project list, which is checked after parsing.
- `evals/extraction/<case>/{input.txt|input.pdf, expected.json, recorded.json}` and `scripts/eval.ts`. The eval runs with `react-server` conditions, or through Vitest, because `server-only` blocks plain Node (R-6).

### Streaming

Streaming must stay inside Server Actions to satisfy R5. The plan is a Server Action that returns an async iterable or `ReadableStream` (React 19 Flight supports this). It will be spiked at 2.1. If that doesn't work, a streaming route handler is needed, and that step stops for `/propose-adr` because route handlers would be writing to `llm_usage` outside a Server Action (R-5).

### Where LLM output crosses a trust boundary (to expand at 2.1)

1. **Pasted text and files → prompt.**
   - Wrap them in delimited tags, with a system prompt saying the content is data.
   - Hidden text (white-on-white in PDFs) is still text; nothing in it is trusted.
2. **Extraction output → review UI.**
   - Parse with Zod; retry once with the validation error, then fail gracefully.
   - Render as text only, never `dangerouslySetInnerHTML` or markdown-to-HTML.
3. **Review UI → DB.**
   - `saveReviewedTasks` re-validates with the same task schema as manual creation.
   - `owner_id` comes from `getUser()` and the project is checked by the FK and RLS.
4. **Ask tool arguments → queries.**
   - Zod-parse every tool input; queries go through the user client (ADR-0003).
   - Tool results that include task titles are themselves untrusted content fed back to the model.
5. **Ask `create_task` → DB.**
   - The tool returns a proposal only.
   - The UI shows it; the click calls `confirmCreateTask`, which re-validates. The model's args are never executed directly.
6. **Assistant text → chat UI.** Plain text, or a sanitizing renderer that doesn't allow raw HTML (D-15).
7. **Usage numbers → cap.** Token counts come from the API response, not from model text.

### Step acceptance (outline)

| Step | Must be true |
|---|---|
| 2.1 | Phase 2 detailed here; streaming spike result recorded; ADR proposed if needed |
| 2.2 | 15–20 owner-written cases; `npm run eval` prints a per-case table and overall score; recorded mode is deterministic and runs in CI with no key |
| 2.3 | Extraction uses strict tool-use schema; invalid output → 1 retry → graceful error; low-confidence items flagged; live eval score in docs/learnings.md |
| 2.4 | Score, latency and cost per case for a Haiku-class and a Sonnet-class model (IDs from docs); a recommendation |
| 2.5 | Tools `search_tasks`, `list_overdue`, `get_project_summary`, `create_task` (proposal only); tool calls shown in UI; **Vitest + pgTAP test: user B asking about user A's project gets nothing** |
| 2.6 | Every call is logged; prompt caching on system prompt and tools; cap enforced with a friendly error; admin page gated by RLS |
| 2.7 | Private bucket; the 10 MB limit and type checks are server-side, by magic bytes and not just extension; 3 attachment eval cases including the hidden-text PDF |
| 2.8 | Injection cases run through Extract and Ask; no tool executes without a click; security-reviewer report attached; `/phase-done` |

Dependencies to ask about in Phase 2: `@anthropic-ai/sdk`, a `.docx` extractor (for example `mammoth`), a VTT/SRT parser (may be hand-written), and a PDF text fallback if Claude's native PDF input isn't used.

---

## 4. Phase 3 — Workspaces, background jobs, production (outline; detailed at 3.1)

### Data model

- `workspaces`:
  - `id`, `name`, `created_by`, `created_at`, `deleted_at` (D-17);
  - `daily_llm_cap_usd numeric null` (null means the default).
- `workspace_members`: `(workspace_id, user_id)` PK, `role` enum (`owner` | `member` | `viewer`), `created_at`.
- `invites`:
  - columns: `id`, `workspace_id`, `email`, `role`, `token_hash`, `invited_by`, `expires_at`, `accepted_at`, `accepted_by`;
  - acceptance goes through `accept_invite(token)`, a `security definer` function that checks the expiry, a single use and that the email matches the signed-in user (D-16).
- `digest_runs`: `id`, `workspace_id`, `week_start date`, `status` (`pending` | `sent` | `skipped` | `failed`), `attempts`, `sent_at`, `error_code`. `unique (workspace_id, week_start)`, so a resumed batch never re-sends.
- `projects`, `tasks`, `attachments` and `llm_usage` gain `workspace_id not null`. Tasks gain `assignee_id` (→ a member) alongside `assignee_text`.

### Membership helper

`is_member(ws uuid, min_role role)`:
- `security definer`, `stable`, `set search_path = ''`;
- reads `workspace_members` for `(select auth.uid())` and compares roles by rank.

Policies on every table call it. The `workspace_members` policies also call it; the definer function bypasses RLS on that table, which removes the recursion.

### Role matrix

| | viewer | member | owner |
|---|---|---|---|
| read projects, tasks, attachments | ✓ | ✓ | ✓ |
| create, update or delete tasks and projects | | ✓ | ✓ |
| manage invites and members | | | ✓ + aal2 to remove members |
| delete workspace | | | ✓ + aal2 |
| read `llm_usage` | own rows | own rows | whole workspace |

`aal2` is enforced in the policy with `(select auth.jwt()->>'aal') = 'aal2'`.

### Migration sequence (to be proven at 3.2 with pgTAP row counts)

1. Create `workspaces`, `workspace_members`, `invites` and `digest_runs` with RLS and `is_member()`.
2. Backfill one "Personal" workspace per existing profile, with that user as owner.
3. Add `workspace_id` as nullable to `projects`, `tasks`, `attachments` and `llm_usage`; backfill it from `owner_id` → the Personal workspace; then set it `not null`.
4. Replace the owner policies with membership policies, in the same migration as step 3's `not null`, so there's no window with neither.
5. Update `handle_new_user()` to also create a Personal workspace for new sign-ups.
6. Move Storage paths to `{workspace_id}/...`: copy the objects, then update the rows. This needs the admin client from an Edge Function or a one-off, and it's a risk to plan at 3.1.
7. Rollback plan:
   - Schema: forward-fix migrations only (R7). A down-migration is still written for local testing, so the step can be undone before merge.
   - Data: take a snapshot before running in prod.

### Other Phase 3 work

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

---

## 7. Risks and guardrail gaps

Items marked **(owner)** involve locked files that I can't and won't change.

| # | Risk | Mitigation |
|---|---|---|
| R-1 **(owner)** | `.claude/hooks/guard.sh` only blocks `rm -rf`. It doesn't block edits to committed migrations, which ADR-0005 says it does. architecture.md §6 names `.claude/hooks/protect-migrations.sh`, which doesn't exist. | CI (`check.sh`) still catches it. Consider extending guard.sh and fixing the §6 name. |
| R-2 **(owner)** | architecture.md §6 lists "ESLint `no-restricted-imports`" for R2 and R3, but there is no ESLint config, and one created at 1.3 would be editable by Claude. dependency-cruiser is the real enforcement. | Either add the ESLint config to the locked paths after 1.3, or drop that row from §6. |
| R-3 **(owner)** | dependency-cruiser R6 only covers `src/components/`. A `"use client"` file under `src/app/` that imports `src/lib/llm/` is caught only by the `server-only` build error, and only for files that import `server-only` directly. | Keep every server-only module importing `server-only` (the required rule enforces this for llm and admin). Put client components in `src/components/`. |
| R-4 | ~~CODEOWNERS placeholder username~~ | Resolved in 1.2: `@randygetc`. |
| R-5 | Streaming vs R5 (§5). | Spike at 2.1; ADR if needed. |
| R-6 | `server-only` throws outside the `react-server` condition, so Vitest and `npm run eval` can't import `src/lib/llm` directly. | Alias `server-only` to a no-op in the Vitest config; run evals through Vitest or with `--conditions=react-server`. Never remove the import to make a test pass. |
| R-7 | The digest Edge Function (Deno) needs Zod schemas and prompts that live in `src/lib/`. | Duplicate a small digest schema in `supabase/functions/_shared/` for now; ADR if sharing is wanted. |
| R-8 | Recurrence with RRULE libraries: `rrule.js` handles time zones poorly (TZID and floating times), so DST bugs are likely. | Expand in local wall-clock time and then convert with a proper tz library. The 1.8 tests are the gate. Choose the library at 1.7 (ask first). |
| R-9 | Rule 13 (no index without measurements) vs normal practice of indexing foreign keys. Phase 1 will have no FK or `due_at` indexes. | Accept it: data is tiny until 3.7, which measures and adds them. Flag if you'd rather allow FK indexes up front. |
| R-10 | `complete_task` race conditions and double submits. | `unique (series_id, due_at)` plus an idempotent function, with a test that runs it twice concurrently. |
| R-11 | `supabase/config.toml` has `additional_redirect_urls = ["https://127.0.0.1:3000"]` (https, no path), and Google isn't configured. | Fix both in 1.5; the redirect must allow `http://127.0.0.1:3000/auth/callback`. |
| R-12 | Realtime `postgres_changes` checks RLS per subscriber per change (slow at scale), and DELETE events aren't RLS-filtered in the same way. | Use Broadcast with private channels and RLS on `realtime.messages`, or soft deletes. Decide at 3.1. |
| R-13 | Prompt injection through stored task titles: a malicious title created by one member is later read by Ask or the digest for another member. | Treat all DB text as untrusted in prompts. Write tools stay proposal-only. Add an eval or test case at 2.8 and 3.6. |
| R-14 | Cap bypass: parallel requests all pass the check before any usage is logged. | Accept small overshoot, or reserve estimated cost before the call. Decide at 2.6. |
| R-15 | Anthropic model IDs and prices change. | `models.ts` and `pricing.ts` are the only places they appear; check the docs at 2.3 and 2.4 (rule 8). |
| R-16 | The Storage path migration in Phase 3 (per-user → per-workspace paths) is not transactional with the table update. | Copy first, flip the rows, and delete old objects only after verification. Plan it in detail at 3.1. |
| R-17 | Library versions have moved on (Next 16 `proxy.ts`, Supabase's new publishable and secret API keys, Zod 4, Tailwind 4). | Verify against current docs at 1.3; record choices in docs/conventions.md. |
