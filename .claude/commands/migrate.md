---
description: Create a schema migration with RLS and pgTAP tests
argument-hint: <what the migration does>
---
Create a new migration for: $ARGUMENTS

1. Check docs/architecture.md. If this needs anything the architecture doesn't allow, stop and use /propose-adr.
2. `supabase migration new <short_name>`, then write the SQL. Never edit a committed migration.
3. Enable RLS on every new table in the same file. Membership checks go through the shared helper function.
4. Write pgTAP tests in supabase/tests/: owner allowed, other user denied, anon denied (and per role once workspaces exist).
5. Run `supabase db reset` and `supabase test db`. Fix failures.
6. Regenerate types: `supabase gen types typescript --local > src/lib/database.types.ts`.
7. Summarize the tables, policies, and tests you added.
