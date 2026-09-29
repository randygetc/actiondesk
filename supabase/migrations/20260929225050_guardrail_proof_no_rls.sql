-- DELIBERATE VIOLATION (step 1.4, #3): public table without RLS. Do not merge.
create table public.guardrail_proof (
  id uuid primary key default gen_random_uuid(),
  note text
);
