# 0004. Mutations go through validated Server Actions

- **Status:** Accepted
- **Date:** 2026-09-28

## Context
The browser could write to Supabase directly (RLS would still protect ownership), but input validation, business rules, and logging would then be spread across client code.

## Decision
All writes go through Server Actions. Each validates its input with a Zod schema from `src/lib/validation/`. LLM output is validated with the same schemas before use. The browser client is used for reads and Realtime subscriptions only.

## Consequences
- One place for validation and business rules.
- One extra network hop for writes compared with direct client writes.

## Rules affected
R5, R6

## Enforcement
Code review and the security-reviewer subagent (not statically enforceable in full); dependency-cruiser keeps server-only modules out of components.
