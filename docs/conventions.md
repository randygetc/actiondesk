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
