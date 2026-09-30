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
