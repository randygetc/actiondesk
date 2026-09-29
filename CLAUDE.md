# ActionDesk

Meeting notes → tasks, with an AI assistant over your work.

This file is LOCKED. You may read it but not edit it. Put new conventions in docs/conventions.md.

@docs/architecture.md
@docs/conventions.md

## Stack
Next.js (App Router) + TypeScript strict · Supabase (Postgres, Auth, RLS, Storage, Realtime, Edge Functions, Cron)
@supabase/ssr · Tailwind + shadcn/ui · Zod · Anthropic TypeScript SDK · server-only
Tests: Vitest, Playwright, pgTAP (`supabase test db`), k6 · Guardrails: dependency-cruiser
CI: GitHub Actions · Deploy: Vercel · Monitoring: Sentry

## Commands
npm run dev · supabase start|stop · supabase migration new <name> · supabase db reset
supabase gen types typescript --local > src/lib/database.types.ts · supabase test db
npm run lint · npm run typecheck · npm test · npm run test:e2e · npm run eval
npx depcruise --config guardrails/dependency-cruiser.cjs src   (architecture import rules)

## Architecture is locked
- The rules in docs/architecture.md §5 are not yours to change.
- Locked paths: CLAUDE.md, docs/architecture.md, docs/adr/, .claude/, guardrails/,
  .github/workflows/guardrails.yml, .github/CODEOWNERS, supabase/tests/000_rls_enabled.test.sql,
  and any committed file in supabase/migrations/.
- If a task seems to need a change to the architecture or a locked path: STOP. Run /propose-adr
  and explain in your reply. Do not implement the change, and never work around a guardrail
  (no shell tricks, no disabling checks, no moving code to dodge an import rule).
- If a guardrail blocks you, report it. Being blocked is expected and fine.

## Working rules
1. Schema changes only through new files in supabase/migrations.
2. RLS enabled in the same migration as each table, with pgTAP tests per policy.
3. Service role client only via src/lib/supabase/admin.ts, imported only from src/lib/admin/** and Edge Functions.
4. LLM tools query Supabase with the user's client so RLS applies; write tools need UI confirmation.
5. On the server, authorize with supabase.auth.getUser(), never getSession().
6. All mutations via Server Actions, validated with Zod from src/lib/validation/.
7. All LLM output is untrusted: validate with Zod before use; never execute it or render it as HTML.
8. Anthropic key is server-only. Check current model IDs in Anthropic docs; don't guess.
9. Timestamps stored as timestamptz (UTC); user timezone on profile; convert only at the edges.
10. Before commit: lint + typecheck + tests + depcruise pass. One step per commit. Ask before adding dependencies.
11. docs/plan.md is the working plan between sessions. Read it at the start of each session.
12. Log through the single structured logger. Never log note contents, extracted text, file contents, tokens, or keys.
13. Measure before optimizing: no index, cache, or query rewrite without before/after numbers.
14. Never merge PRs, push to main, or change PR labels. The owner does that.
