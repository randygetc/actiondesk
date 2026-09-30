-- Step 2.3: LLM usage log (D-12, D-19) and where a task came from (D-13).
-- docs/plan.md §3.2.

-- llm_usage ---------------------------------------------------------------

create type public.llm_feature as enum ('extract', 'ask');
create type public.llm_outcome as enum ('ok', 'invalid_output', 'error', 'capped', 'aborted');

create table public.llm_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  feature public.llm_feature not null,
  model text not null check (char_length(model) between 1 and 100),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_tokens integer not null default 0 check (cached_tokens >= 0),
  cost_usd numeric(10, 6) not null default 0 check (cost_usd >= 0),
  outcome public.llm_outcome not null,
  latency_ms integer not null default 0 check (latency_ms >= 0),
  request_id text check (char_length(request_id) <= 200),
  prompt_version text check (char_length(prompt_version) <= 50),
  created_at timestamptz not null default now()
);

alter table public.llm_usage enable row level security;

-- Append-only: no client writes at all, so a user can't erase usage to reset
-- their cap. Rows arrive only through log_llm_usage().
revoke all on public.llm_usage from anon, authenticated;
grant select on public.llm_usage to authenticated;

create policy "llm_usage: select own"
  on public.llm_usage for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Writes one usage row for the caller. security definer because the table has
-- no insert grant; user_id always comes from auth.uid(), never an argument.
create function public.log_llm_usage(
  p_feature public.llm_feature,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_tokens integer,
  p_cost_usd numeric,
  p_outcome public.llm_outcome,
  p_latency_ms integer,
  p_request_id text default null,
  p_prompt_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.llm_usage
    (user_id, feature, model, input_tokens, output_tokens, cached_tokens,
     cost_usd, outcome, latency_ms, request_id, prompt_version)
  values
    (uid, p_feature, p_model, p_input_tokens, p_output_tokens, p_cached_tokens,
     p_cost_usd, p_outcome, p_latency_ms, p_request_id, p_prompt_version)
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.log_llm_usage(
  public.llm_feature, text, integer, integer, integer, numeric, public.llm_outcome, integer, text, text
) from public, anon;
grant execute on function public.log_llm_usage(
  public.llm_feature, text, integer, integer, integer, numeric, public.llm_outcome, integer, text, text
) to authenticated;

-- The caller's spend since local midnight in p_tz (the daily cap, step 2.6).
-- security invoker: RLS limits the sum to the caller's own rows.
create function public.llm_spend_today(p_tz text)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'invalid time zone: %', p_tz using errcode = '22023';
  end if;

  return coalesce((
    select sum(u.cost_usd)
      from public.llm_usage u
     where u.user_id = (select auth.uid())
       and u.created_at >= (date_trunc('day', now() at time zone p_tz) at time zone p_tz)
  ), 0);
end;
$$;

revoke execute on function public.llm_spend_today(text) from public, anon;
grant execute on function public.llm_spend_today(text) to authenticated;

-- tasks: provenance -------------------------------------------------------

create type public.task_source as enum ('manual', 'extraction', 'ask');

alter table public.tasks
  add column source public.task_source not null default 'manual',
  -- Shown as plain text only (trust boundary 2, plan §3.8).
  add column source_quote text check (char_length(source_quote) <= 500),
  -- Free-text owner from extraction (D-13); not a user reference.
  add column assignee_text text check (char_length(assignee_text) <= 200);

-- Provenance is set once at creation; assignee_text stays editable.
grant insert (source, source_quote, assignee_text) on public.tasks to authenticated;
grant update (assignee_text) on public.tasks to authenticated;
