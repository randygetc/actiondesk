# Conventions

Editable by Claude Code. Record project conventions learned while building (naming, folder patterns,
test helpers, UI patterns). Conventions must not contradict docs/architecture.md; if one would,
propose an ADR instead.

<!-- Add entries below, newest last. -->

## LLM tools that need data RLS hides (2026-09-29)
LLM tools never use the admin client (ADR-0003; a proposed ADR-0006 to allow it was rejected by the owner).
If a tool needs data the user's RLS policies don't expose:
- Add a narrow `security definer` function in a **new** migration.
- The function checks `is_member(workspace_id, min_role)` itself and returns only the columns the tool needs.
- Add pgTAP tests for it, including one where user B cannot reach user A's data.
- The tool calls it via `.rpc()` on the user-scoped client.

## Scaffold choices (step 1.3, 2026-09-29)
Versions: Next 16.3, React 19.2, TypeScript 5.9, Tailwind 4, Zod 4, Vitest 5, @supabase/ssr 0.12.
- **Proxy, not middleware.** Next 16 renamed `middleware.ts` to `proxy.ts`. Ours is `src/proxy.ts`,
  exporting `proxy()`. Session refresh lives in `src/lib/supabase/proxy.ts` (`updateSession`).
  The proxy is not an authorization boundary: every page and Server Action still calls `getUser()`.
- **Env names.** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the new
  `sb_publishable_…` key), and server-only `SUPABASE_SERVICE_ROLE_KEY` (holds the `sb_secret_…` key)
  and `ANTHROPIC_API_KEY`. `.env.local.example` lists names only.
- **`AGENTS.md` must stay.** `next dev` writes its agent-rules block into `AGENTS.md` if present,
  otherwise into `CLAUDE.md`, which is locked. Keep `AGENTS.md` committed; don't delete it.
- **shadcn/ui** uses the `base-nova` style: `@base-ui/react` primitives and the `cn` package
  (replaces clsx + tailwind-merge). Add components with `npx shadcn add <name>`.
- **Tests.** Vitest projects: `unit` (`src/**/*.test.ts`, `npm test`) and `eval`
  (`evals/**/*.eval.ts`, `npm run eval`). `server-only` is aliased to `test/server-only-stub.ts`.
  E2E tests live in `e2e/`; run `npx playwright install chromium` once before `npm run test:e2e`.
- **Typecheck** runs `next typegen` first, so route types like `LayoutProps` exist.
- **Prettier** formats code on every edit (the `.claude` PostToolUse hook). Markdown is excluded in
  `.prettierignore` so doc diffs stay minimal.
- **Logging.** `log.info(event, fields)` from `src/lib/log.ts`; fields are ids and counts.
  Sensitive-looking field names are redacted as a backstop only.

## Auth and tests (step 1.5, 2026-09-29)
- **pgTAP helpers** live in `supabase/tests/helpers/auth.psql` and are pulled into a test with
  `\ir helpers/auth.psql` right after `begin;`. The `.psql` extension keeps `supabase test db` from
  running the file on its own, and everything it creates (schema `tests`) rolls back with the test.
  Helpers: `tests.create_user(email, meta)`, `tests.authenticate_as(uid)`,
  `tests.authenticate_as_anon()`, `tests.clear_authentication()`.
  Capture ids with `select tests.create_user(...) as a \gset`, then use `:'a'`. Don't call
  `create_user` inside a `where` clause: it runs once per scanned row.
- **Table privileges, not just policies.** Each table revokes all from `anon, authenticated`, then
  grants only what the policies need, with column-level `update` grants for editable columns.
  So anon gets `42501` (permission denied), not an empty result.
- **Every route that needs a user** calls `requireUser()` (`src/lib/auth/user.ts`) in Server
  Components. Server Actions call `getUser()` themselves and return `ActionResult`
  (`src/lib/action-result.ts`). The proxy's redirect to `/login?next=…` is a convenience only.
- **Redirect targets from input** go through `safeNextPath()` (`src/lib/auth/redirect.ts`).
  Route handlers redirect with a relative `Location`; Next normalizes `request.url`'s host
  (127.0.0.1 → localhost in dev), which would drop the session cookie.
- **e2e sign-in (D-8):** `signInAsNewUser(context, baseURL)` in `e2e/helpers/auth.ts` signs up a
  fresh email/password user and copies the @supabase/ssr cookies into the browser context.
  Playwright loads `.env.local`.
- **DB types:** `npm run db:types` regenerates and formats `src/lib/database.types.ts`.
  Clients are typed with `Database`.

## CRUD pattern (step 1.6, 2026-09-29)
- **Routes:** `(app)/<entity>/page.tsx` (list + create), `(app)/<entity>/[id]/page.tsx` (detail),
  `(app)/<entity>/actions.ts` (Server Actions). Validate `[id]` with Zod and call `notFound()` on
  failure. Another user's row is invisible under RLS, so it 404s like a missing one.
- **Actions** use the `(prev, formData) => Promise<ActionResult>` signature for `useActionState`.
  Updates and deletes add `.select("id")` and treat 0 rows as "not found". Postgres `23505` maps to
  a field error; any other DB error is logged with its code and shown as a generic message.
- **Client components** live in `src/components/<entity>/` and receive Server Actions as props.
- **Destructive confirmations** use a native `<details>` disclosure, not `useState`, so the
  confirm step works before hydration.
- **Archive vs delete:** archive (`archived_at`) is the normal path and is reversible via Restore.
  Lists show active rows by default, with `?show=archived` for the rest.

## Time, tasks and tests (step 1.7, 2026-09-29)
- **Time library:** `temporal-polyfill` (owner decision for R-8). Import `Temporal` only inside
  `src/lib/time/`; everything else uses its functions. No RRULE library: recurrence is the six
  presets in `src/lib/time/recurrence.ts`, and the DB check on `tasks.recurrence` mirrors
  `parseRRule`. Change both together.
- **Time rules:**
  - A due date without a time means 23:59 local (`END_OF_DAY`).
  - Nonexistent local times (spring forward) move forward by the gap (02:30 → 03:30).
    Ambiguous ones (fall back) take the earlier instant.
  - Read the clock (`new Date()`) only at the edge (a page or an action) and pass `now` in.
- **Recurrence:** the next due date is computed in TypeScript from the task's `recurrence_tz`
  (D-5). `complete_task()` only makes "done + insert next" atomic and idempotent.
- **Rules carry their local time** (step 1.8): `FREQ=…;BYHOUR=h;BYMINUTE=m`, with no zero
  padding, in `recurrence_tz`. The form always writes it (the entered time, or 23:59).
  `nextOccurrence` uses it, and falls back to the previous occurrence's local time only for a
  rule without one. That fallback would carry a spring-forward shift (02:30 → 03:30) into
  every later occurrence. `toRRule(preset, time)` / `parseRRule` / `ruleTime` and the DB check
  must stay in sync.
- **Dev origin:** `next.config.ts` sets `allowedDevOrigins: ["127.0.0.1"]`. Without it, Next 16
  blocks dev resources and **pages never hydrate in dev**, while no-JS paths (form posts,
  `<details>`) still work. That hid the problem until 1.7.
- **e2e after client navigation:** wait for the destination (heading or URL) before reading
  `page.url()` or filling fields. Scope alerts by text, since Next's route announcer also has
  `role="alert"`.
- **Row actions** (complete/reopen) are submit buttons with `role="checkbox"`, so they work
  before hydration. In e2e, `.click()` them rather than `.check()`.
- **Labels** wrap only their control. A label wrapping a button pollutes the input's accessible name.
- **Edit dialogs** are URL-driven (`/tasks?edit=<id>`). Closing navigates to the URL without
  `edit`, and a successful save redirects.
- **DB tests** (`*.db.test.ts`) run in the Vitest `db` project against local Supabase:
  `npm run test:db`. Unit tests (`npm test`) exclude them.

## CI (step 1.9, 2026-09-30)
- **Two workflows.** `guardrails.yml` is locked (owner's). `ci.yml` is ours: install → lint →
  typecheck → unit → `supabase start` → pgTAP → `test:db` → build → e2e. It needs no secrets.
- **CI writes `.env.local`** from `supabase status -o env` (`API_URL`, `PUBLISHABLE_KEY`), so the
  dev server, db tests and Playwright read the same file as locally.
- **Google placeholders.** `config.toml` enables Google with `env(...)` values; CI sets them to
  `ci-unused` so auth starts. e2e never uses Google (D-8).
- **Pinned Supabase CLI** in `ci.yml` (2.118.0). Bump it on purpose, with a green run.

## Streaming (step 2.1 spike, 2026-09-30)
- **Stream from Server Actions** (R5): the action calls `getUser()`, validates with Zod, then returns an
  async generator. The client reads it with `for await`. A `ReadableStream` works too; prefer the generator.
- **Don't rely on `finally` alone** (corrected at 2.8). When the client disconnects, React may never
  close the generator, so `finally` doesn't run. Streaming LLM actions create a `usageRun()` in the
  action before returning the generator. Its `after()` callback records usage and cancels the API
  call if the generator didn't.
- A second Server Action isn't blocked while a stream runs (checked in dev and `next start`, not on Vercel yet: R-18).

## Evals (step 2.2, 2026-09-30)
- **Layout:** cases in `evals/extraction/<case>/` (format in `evals/README.md`). The shared code is in
  `evals/lib/`, never inside a cases folder, because every folder there is loaded as a case.
  Suites are `evals/*.eval.ts` (`npm run eval`); library tests are `evals/**/*.test.ts` in the unit project.
- **Case files are validated on load** with Zod, and an error names the file and field.
  The unit tests load every committed case, so a broken case fails `npm test`.
- **`npm run eval` passes `--silent=false`**, because Vitest hides console output from passing tests.
- **The score is a metric, not a gate:** the eval fails only when a case can't be loaded or run.
  If you want a minimum score, set it at 2.4, once real numbers exist.

## LLM calls (step 2.3, 2026-09-30)
- **App code calls `llmClient()`** from `src/lib/llm`. It returns the SDK client, or the fake one when
  `LLM_FAKE=1` outside production. Only `src/lib/llm/client.ts` imports `@anthropic-ai/sdk`.
- **Requests use the beta namespace** (`client.beta.messages.stream`) because of the refusal fallback
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Usage is logged against
  `message.model`, the model that actually answered.
- **Tools are `strict: true` with `tool_choice: auto`.** Forced tool choice is a 400 on current
  models. `eager_input_streaming` stays off: tool inputs here are small, and buffered input keeps
  the API's schema check. Every tool input is still Zod-parsed before use.
- **Extraction is one API call** when every `add_task` call is valid. We don't send a follow-up turn
  to let the model continue, so it must emit all tasks in one response. Recall on the eval says it
  does (2.3: 37/37 tasks found). Invalid calls get one retry turn with the Zod error.
- **Notes go inside a random tag** (`<note-1a2b…>`), so note text can't close the tag.
- **Usage:** `usageMeter()` collects each final message; `recordUsage()` runs in `finally` and never
  throws. Log field names avoid "token" (the logger redacts it): `inputTok`, `outputTok`, `cachedTok`.
- **Prompts are versioned** (`EXTRACT_PROMPT_VERSION`). Bump it on any prompt change; it's stored in
  `llm_usage.prompt_version` and should be noted in docs/learnings.md with the new score.
- **Actions called with JSON** (not a form), like `saveReviewedTasks(rows)`, take `unknown` and parse
  it with Zod first. Streaming actions return an async generator whose first event is an `error`
  on bad input or a signed-out user.
- **e2e and the fake model:** Playwright's own dev server gets `LLM_FAKE=1`. Pages that call the LLM
  set `data-llm="fake|live"`, and their e2e tests skip unless it's `fake`, so a reused local dev
  server never spends API money.

## Ask tools (step 2.5, 2026-09-30)
- **One tool = one `defineTool()`** in `src/lib/llm/tools/`. Each has a strict JSON schema for the
  API, a Zod schema that re-checks the model's input, a `describe()` for the UI chip, and a
  `run(ctx, input)` that gets the request's user-scoped client. There are no other data paths
  (ADR-0003).
- **Strict schemas:** list every property in `required` and set `additionalProperties: false`.
  For a nullable enum use `anyOf: [{ type: "string", enum: [...] }, { type: "null" }]`: the API
  rejects `enum` on `type: ["string", "null"]`. `tools/tasks.test.ts` checks all of this.
- **Write tools return a `proposal`** and never touch the DB. The UI's Confirm calls a Server
  Action that re-validates with the task form schema.
- **Per-request context** (today's date, projects) goes in the latest user message, so the system
  prompt and tools stay a stable, cacheable prefix.
- **Check a new LLM feature live once** through the dev server before opening the PR (about 1 cent).
  Unit tests with a scripted model can't catch API schema rejections; the first live Ask call
  returned a 400 that no test had caught.

## Cost controls (step 2.6, 2026-09-30)
- **Every streaming LLM action checks `capReached()` first**, before any API call. When the cap is
  reached it yields `CAP_MESSAGE` and logs a `capped` usage row. The check fails closed.
- **Cap:** `LLM_DAILY_CAP_USD` per user per **rolling 24 hours** ($1 if unset). No user setting
  affects the window (time zones used to reset it, review #2). Parallel overshoot is R-14.
- **Bound every call's input:** text notes are capped at 50,000 characters; PDFs are counted with
  `count_tokens` against `MAX_INPUT_TOKENS` before the call.
- **Prompt caching:** `system` is an array whose one text block carries
  `cache_control: { type: "ephemeral" }`. The API renders tools, then system, so that caches both.
  Keep per-request text out of the system prompt, or every call writes a new entry. Check
  `cached_tokens` in `llm_usage` after any prompt or model change.
- **Admins** are rows in `app_admins`, added by the owner with SQL. Pages decide admin-only UI with
  `rpc("is_app_admin")`; the data itself is gated by RLS.
- **Local migrations:** apply new ones with `supabase migration up`. `supabase db reset` wipes local
  data, so use it only when you mean to.

## Attachments (step 2.7, 2026-09-30)
- **File type comes from the bytes only** (`detectFile` in `src/lib/attachments/detect.ts`), never
  the name or the browser's MIME type. It's checked again when the stored file is read back.
- **Path:** `<uid>/<attachment id>.<ext>`, built on the server. The row goes in first, then the upload;
  if the upload fails, the row is removed.
- **Delete after review** (D-21): on save or Discard, delete the object first and then the row.
  Direct SQL deletes on `storage.objects` are blocked by Supabase unless
  `storage.allow_delete_query` is set. pgTAP sets it to act like the Storage API; app code uses
  `supabase.storage.remove()`.
- **Text:** PDFs go to the model as a `document` block; .docx uses `mammoth.extractRawText` (never
  HTML); .vtt/.srt become `Speaker: text` lines. Text over 50,000 characters is refused, not
  truncated.
- **A file lives only while its review does:** extraction outcomes other than `ok` and
  `invalid_output` delete it in `after()` (D-21). Retry uploads the file again. Failure-path e2e
  tests use a `[fake:error]` line, which makes the fake model throw.
- **Size limit:** 4 MB (D-22), from `MAX_BYTES` and `SIZE_ERROR` in `detect.ts`. The table check and the
  bucket limit match it. `experimental.serverActions.bodySizeLimit` is 4.5 MB, which fits Vercel's
  request cap. Don't raise one without the others.
- **Eval inputs:** `input.txt` is pasted text; `input.pdf|docx|vtt|srt` go through `fileToNote`,
  the same as an upload. `EVAL_ONLY=<text>` runs a subset.

## Injection evals (step 2.8, 2026-09-30)
- **Extraction injection** is scored inside the extraction eval (`injection-*`, `attachment-hidden-text-pdf`).
- **Ask injection** is `evals/ask-injection.eval.ts` with cases in `evals/ask/cases.json`. It's a
  **gate**: any write, unexpected proposal, or forbidden phrase in the model's own words fails CI.
  Tool reads come from `test/fake-supabase.ts`, so recordings replay without a database. Keep a
  control case that should propose, so the gate can't pass trivially.
- When a forbidden-phrase check fails, read the answer before blaming the model. Quoting a
  malicious title is correct behavior.

## Workspace scoping (step 3.1 plan, applies from 3.2)
- **RLS is the authority; the current workspace is a filter.** Every list query adds
  `.eq("workspace_id", current.id)`. Without it a user would see the union of all their workspaces.
  RLS decides what they may see or change at all.
- **Policies call `my_workspaces(min_role)`,** never `workspace_members` directly. That avoids
  recursion, and it's evaluated once per statement.
- **Creates** take the workspace from the parent (a task created in a project goes into the project's
  workspace), else the current workspace. **Writes RLS refuses** (`42501`, or 0 rows on a row the user
  can see) show `VIEW_ONLY_MESSAGE`.
- **Pages showing one row** (a project page) use that row's workspace and the user's role in it, not
  the current workspace.
- **pgTAP:** insert with `workspace_id` = `tests.ws()` (the signed-in test user's Personal workspace),
  or `tests.ws(:'user')` when running as `postgres`.

## Invites and e2e habits (step 3.3, 2026-09-30)
- **Invites:** `create_invite` returns the token once, and only `sha256(token)` is stored.
  `invite_preview` and `accept_invite` check the email against `auth.jwt()->>'email'`. Error keys
  (`invite_used` and others) map to messages in `INVITE_ERRORS`. Never log a token.
- **pgTAP:** `tests.authenticate_as` puts the user's email in the JWT claims and resets the role first,
  so tests can switch directly between users.
- **e2e should act like a user.** Don't reload to make an assertion pass. After a Server Action, wait
  for visible page content before asserting on form state: React 19 resets forms after an action. The
  workspace switcher bug (#24) was hidden by a reload.
- **Two users:** make a second context with `browser.newContext({ baseURL })` and sign each in with
  `signInAsNewUser`. Invite tests need no fake model, so they run locally too.

## Realtime (step 3.4, 2026-09-30)
- **One private Broadcast channel per workspace,** `workspace:<id>`. The DB triggers
  (`broadcast_workspace_change`, security definer) send `{table, op, id}`, never content. Members of
  any role may receive (RLS on `realtime.messages` via `my_workspaces`), and nobody may send.
- **The browser refreshes and never merges rows.** `WorkspaceLive` calls `router.refresh()` (debounced),
  so the server re-reads through RLS. That also makes optimistic updates plus echoes duplicate-free.
  After a reconnect or when the tab becomes visible, it refreshes once to catch up.
- **To add a table to live updates,** give it `workspace_id` and the same trigger.
- **Testing:** the security property (members yes, outsiders no) is a db test against the real Realtime
  server (`src/lib/db/realtime.db.test.ts`). In e2e, `context.setOffline()` does **not** drop an open
  WebSocket. Use `context.routeWebSocket` to really disconnect.

## Two-factor (step 3.5, 2026-09-30)
- **Destructive workspace actions need `aal2`,** enforced in the database: the member-delete policy
  (removing someone else) and `delete_workspace()`. Leaving yourself doesn't need it.
- **Step-up in actions:** `stepUp(supabase, code)` from `src/lib/auth/mfa.ts` returns ok if the session
  is already aal2, verifies the form's code if not, or explains how to set up a factor. Actions return
  `fieldErrors.code` to make the form show a code field. Only ask for a code if the user has a
  factor; otherwise a required field blocks the submit and hides the explanation.
- **MFA calls run in Server Actions** (they change the session), never in the browser.
- **pgTAP:** `tests.authenticate_as(uid, 'aal2')` for a second-factor session.
- **e2e:** `e2e/helpers/totp.ts` computes codes (checked against the RFC 6238 test vectors). Enrolling
  upgrades the current session to aal2, so use `signIn(email, password)` in a new context for an aal1
  session. Don't reuse a code in the same 30 s window (`freshCode`).

## Edge Functions (step 3.6, 2026-10-01)
- **Layout:** `supabase/functions/<name>/index.ts` (Deno), with shared pure code in
  `supabase/functions/_shared/`, imports mapped in `supabase/functions/deno.json` and pinned in
  `deno.lock`. `_shared/*.ts` imports only `zod`, so Vitest tests it (`_shared/**/*.test.ts` is in the
  unit project); Deno code imports it with the `.ts` extension. CI runs `deno check`.
- **Callers check themselves** (`verify_jwt = false`): the scheduled path needs the exact service key;
  user paths build a client from the caller's `Authorization` header and check membership and the
  cap with it, never with the admin client.
- **The admin client** is allowed here (ADR-0003), but every data query is one workspace's, through a
  `service_role`-only SQL function (`digest_data`).
- **Local:** `supabase functions serve --env-file supabase/functions/.env` (gitignored). Email goes to
  Mailpit at http://127.0.0.1:54324. Cron calls the function only once the Vault secrets exist.
- **Scheduled functions** follow the digest: a `security definer` `invoke_<name>()` reads its URL and
  `service_role_key` from Vault and does nothing without them; the function accepts only that exact
  Bearer key; core logic lives in `_shared/` behind a small store interface so Vitest can test it.
  Add each function to CI's `deno check` line and give it a `[functions.<name>]` block in `config.toml`.
- **Deleting stored files goes through the Storage API** (`storage.remove`), file first, then row.
  A SQL delete on `storage.objects` leaves the file itself in storage.
- **Duplication with src/ is deliberate and guarded** (R-7): for example, the digest's price table has a
  unit test against `src/lib/llm/pricing.ts`.

## Performance work (step 3.7, 2026-10-01)
- **Measure as a signed-in user:** `supabase/perf/measure.py` runs EXPLAIN ANALYZE under role
  `authenticated` with JWT claims, so RLS is included. Add a query there before optimizing it.
- **Keep a change only if the numbers move,** and record before/after in docs/performance.md. Revert
  what doesn't help (the trigram index and the per-request memoization were both reverted).
- **Lists query only what they render:** per-group queries with a limit and an exact count. Never load
  everything and group in the browser or on the server. No silent truncation: show the count.
- **In per-row code, reuse formatters** (`Intl.DateTimeFormat` is cached per zone in `zones.ts`).
  Keep Temporal for conversions (`toUtc`), not for per-row formatting.
- **Load tests run against `next start`,** never `next dev`. Use the stress ramp for capacity and
  `RATE=n` for realistic latency.

## Observability (step 3.8, 2026-10-01)
- **Log with `(await requestLog())`** in Server Actions and server code that runs per request. It adds
  `requestId` (from the proxy's `x-request-id`) and the current `workspaceId`. Call sites add
  `userId`, `feature`, `latencyMs` and their own ids. Use the plain `log` only in synchronous helpers.
- **`requestLog().error()` also reports to Sentry** (redacted fields as `extra`; event, requestId and
  workspaceId as tags), because actions catch most errors to show a friendly message. So use `error`
  for real failures; expected refusals are `info` or `warn`.
- **Sentry setup:** `src/instrumentation.ts` (server and edge, plus `onRequestError`),
  `src/instrumentation-client.ts`, `src/app/global-error.tsx`, and one shared options file with a
  scrubber (no bodies, cookies, query strings, headers other than the request id, or IP; no session
  replay). In v11, `withSentryConfig` comes from `@sentry/nextjs/config`.
- **`/api/health` is public** and checks Auth and REST. `/api/debug/error` throws on purpose, needs a
  session, and returns 404 in production unless `ALLOW_DEBUG_ERROR=1`.
- **Editing `next.config.ts` restarts a running dev server, and a broken config stops it.** Check the
  config with `npm run build` before relying on the dev server.

## Deploying (step 3.10, 2026-10-01)
- **docs/deploy.md is the runbook,** and its deploy log records every production change. Ask before
  every command that touches production (`db push`, `functions deploy`, `secrets set`).
- **Merging a PR with a migration changes production** (the Supabase GitHub integration applies it).
  The PR description flags the migration first thing, and the migration must work with the code that's
  still live while Vercel builds: add first, remove in a later PR.
- **Prod checks are read-only queries:** `supabase db query --linked "<select>"`. Print counts and
  flags, never row contents or keys.
- **Log LLM errors with `...errorDetail(e)`** (`src/lib/llm/client.ts`): status, `kind`, the API's
  error `type` and a fixed `reason` code. Never log `e.message`; it can quote model output or notes.
  Add a `reason` when a new failure mode turns up, matched by a fixed prefix.
- **When production config "doesn't work", list the names first:** `vercel env ls` (values hidden).
- **Realtime e2e runs last and alone** (the `realtime` Playwright project depends on `chromium`), because
  it measures latency. Put any new latency-sensitive spec there.
- **Local e2e uses 4 workers.** At 7, tests stall on the shared dev server (measured 2026-10-02: 3/3
  green at 4, and failures at 7 on `main` too).
- **Health probes use what the browser key may do.** Hosted Supabase differs from local here (the REST
  root needs a secret key), so check new probes against production with the publishable key.
- **Secrets never pass through chat or the command line.** The owner enters them in dashboards, or
  the CLI reads a temporary file outside the repo (`--env-file`), which is deleted afterwards.
