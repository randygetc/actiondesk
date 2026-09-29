# 0001. Row-level security is the authorization layer

- **Status:** Accepted
- **Date:** 2026-09-28

## Context
Authorization checks scattered across Server Actions, LLM tools, Realtime, and Storage will drift. One missed check leaks another user's or workspace's data. AI-generated code makes this more likely, not less.

## Decision
Postgres RLS is the single source of truth for who can read or write which rows. Every public table has RLS enabled in the same migration that creates it, with pgTAP tests per policy (owner allowed, other user denied, anon denied; per role once workspaces exist). Application code may also check permissions for clearer errors, but never instead of RLS. The service-role client, which bypasses RLS, is confined to `src/lib/supabase/admin.ts`, imported only from `src/lib/admin/**` and Edge Functions.

## Consequences
- A bug in server code cannot expose rows the user isn't entitled to.
- Authorization logic lives in SQL, which is harder to read and debug than TypeScript.
- Per-row policy checks cost performance at scale; membership checks go through one indexed `security definer` helper.

## Rules affected
R1, R3

## Enforcement
`supabase/tests/000_rls_enabled.test.sql` (RLS on), per-table pgTAP tests (policies correct), dependency-cruiser rule `R3-admin-client-restricted`.
