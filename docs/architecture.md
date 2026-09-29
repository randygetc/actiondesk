# ActionDesk Architecture

**Status:** Locked. Changes require an accepted ADR in `docs/adr/`. Claude Code may read this file but must not edit it.

## 1. Shape

Three tiers. Each tier assumes the one above it might be wrong.

| Tier | Runs on | Owns | Must never |
|---|---|---|---|
| Browser | User's device | Rendering, local UI state, Realtime subscriptions | Hold the service role key or Anthropic key; make authorization decisions |
| Next.js server | Vercel | Server Actions (validated mutations), LLM service, session middleware | Use the admin client in a user request path; trust client input or LLM output unvalidated |
| Supabase | Supabase | Data, authorization (RLS), identity (Auth), files (Storage), scheduled jobs (Edge Functions + Cron) | Contain a public table without RLS |

External services: Anthropic API (called only from the server tier and Edge Functions), Sentry, email provider.

## 2. Trust boundaries

1. **Browser → server:** every input validated with Zod in the Server Action. Nothing from the client is used for authorization.
2. **User content → LLM:** pasted text and uploaded files are hostile input. The LLM may extract; a human approves before anything is saved.
3. **LLM → application code:** model output is validated with Zod like user input. Tools that write data require confirmation in the UI.
4. **Server → database:** RLS is the final authority. A server bug must not be able to expose another user's or workspace's rows.

## 3. Data model (outline)

- Identity: `profiles` (incl. `timezone`), `workspaces`, `workspace_members` (`role`: owner | member | viewer), `invites`
- Work: `projects`, `tasks` (`due_at` timestamptz UTC, `recurrence` RRULE, `status`), `attachments`
- AI & ops: `llm_usage`, `digest_runs`

Almost every row carries `workspace_id`. Membership checks go through one `security definer` helper (e.g. `is_member(workspace_id, min_role)`) to avoid RLS recursion and keep a single place to optimize.

## 4. Code layout

```
src/app/                 routes and Server Actions (user request paths)
src/lib/supabase/
  server.ts              user-scoped server client     ← default everywhere
  client.ts              browser client
  admin.ts               service-role client           ← restricted (see §5)
src/lib/llm/             the only place the Anthropic SDK is imported (server)
src/lib/validation/      Zod schemas shared by actions and LLM output
supabase/migrations/     append-only
supabase/functions/      Edge Functions (Deno); may use admin client and Anthropic SDK
supabase/tests/          pgTAP
```

## 5. Rules

| # | Rule | ADR |
|---|---|---|
| R1 | Every public table has RLS enabled, with tested policies | 0001 |
| R2 | Anthropic SDK imported only in `src/lib/llm/**` and `supabase/functions/**` | 0002 |
| R3 | `src/lib/supabase/admin.ts` imported only from `src/lib/admin/**` and `supabase/functions/**` | 0001, 0003 |
| R4 | LLM tools query with the user-scoped client; write tools need UI confirmation | 0003 |
| R5 | Mutations only via Server Actions with Zod validation; LLM output validated the same way | 0004 |
| R6 | Browser code (`"use client"` modules, `src/components/**`) never imports from `src/lib/llm/**`, `src/lib/supabase/admin.ts`, or `server-only` modules | 0002, 0004 |
| R7 | Committed migration files are never modified; changes go in new migrations | 0005 |

## 6. Enforcement

Rules only count if something checks them. Instructions alone are not enforcement.

| Layer | What it enforces | Can Claude bypass it? |
|---|---|---|
| `CLAUDE.md` + this doc | All rules, as instructions | Yes — advisory only |
| `.claude/settings.json` deny rules | No edits to CLAUDE.md, this doc, ADRs, `.claude/`, CODEOWNERS, the RLS-coverage test | Only via shell tricks; caught by CI/CODEOWNERS |
| `.claude/hooks/protect-migrations.sh` | R7 during the session | Only via shell tricks; caught by CI |
| ESLint `no-restricted-imports` | R2, R3 | No — CI fails |
| dependency-cruiser | R6 | No — CI fails |
| `supabase/tests/000_rls_enabled.test.sql` | R1 (RLS switched on) | No — CI fails |
| Per-table pgTAP tests | R1 (policies correct), R4 | No — CI fails |
| `scripts/check-migrations.sh` in CI | R7 (diff against `main` shows no modified migrations) | No — CI fails |
| Branch protection + only you merge | Nothing reaches `main` without green CI and your decision | No |

## 7. Changing the architecture

1. Claude stops and proposes an ADR **in its reply** (context, decision, consequences, which rules change). It does not implement the change.
2. You decide. If accepted, **you** add the ADR file and update this doc and any guardrail config, in a commit of your own.
3. Claude then implements against the new version.

Superseded ADRs are marked `Superseded by NNNN`, never deleted.
