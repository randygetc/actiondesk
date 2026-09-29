# 0002. LLM calls are server-side only, through one module

- **Status:** Accepted
- **Date:** 2026-09-28

## Context
The Anthropic key must never reach the browser. Prompts, model choice, output validation, usage logging, and cost limits must be applied consistently to every call.

## Decision
The Anthropic SDK is imported only in `src/lib/llm/**` (Next.js server) and `supabase/functions/**` (Edge Functions). Every module in `src/lib/llm/` imports `server-only`. All app features call the LLM through this module.

## Consequences
- One place for keys, prompts, validation, caching, logging, and caps.
- Streaming to the browser must go through server routes or Server Actions.
- Prompts and schemas shared with Edge Functions need a deliberate shared package later.

## Rules affected
R2, R6

## Enforcement
dependency-cruiser rules `R2-anthropic-sdk-only-in-llm`, `R6-no-server-code-in-components`, and required rule `server-only-in-llm-and-admin`; Next.js build fails if a client component imports a `server-only` module.
