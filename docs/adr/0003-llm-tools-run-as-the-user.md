# 0003. LLM tools run as the user

- **Status:** Accepted
- **Date:** 2026-09-28

## Context
Ask ActionDesk lets Claude call tools that read and write data. If tools use the service-role client, prompt injection or a model mistake can reach any workspace's data.

## Decision
Every LLM tool receives the user-scoped Supabase client created for the current request, so RLS applies to every query. Tools that write data (e.g. `create_task`) return a proposed action; the UI shows it and the user confirms before it executes. The only exception is the weekly digest Edge Function, which runs without a user and uses the admin client with explicit per-workspace scoping.

## Consequences
- Injection that asks for another workspace's data gets empty results.
- The model cannot change data without a human click.
- Slightly more UI work for confirmation flows.

## Rules affected
R3, R4

## Enforcement
dependency-cruiser `R3-admin-client-restricted` (llm module cannot import admin client); pgTAP and Vitest tests where user B asks about user A's data.
