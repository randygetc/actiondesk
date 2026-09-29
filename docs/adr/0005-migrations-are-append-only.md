# 0005. Migrations are append-only

- **Status:** Accepted
- **Date:** 2026-09-28

## Context
A migration that has been committed may already be applied to a teammate's database, CI, or production. Editing it makes environments silently diverge.

## Decision
Once a migration file is committed, it is never modified, renamed, or deleted. Every schema change is a new migration. Uncommitted migrations may be edited while developing locally.

## Consequences
- Every environment can be rebuilt reproducibly from the migration history.
- Mistakes are fixed forward with a new migration, which adds files over time.

## Rules affected
R7

## Enforcement
`.claude/hooks/guard.sh` blocks edits to committed migration files during a session; `guardrails/check.sh` fails CI if any migration under `supabase/migrations/` is modified, renamed, or deleted relative to `main`.
