-- Step 3.2 (3 of 3): usage rows can name a workspace (reporting only, D-25),
-- and workspace owners can read their workspace's usage. docs/plan.md §4.4.

drop function public.log_llm_usage(
  public.llm_feature, text, integer, integer, integer, numeric, public.llm_outcome, integer, text, text
);

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
  p_prompt_version text default null,
  p_workspace_id uuid default null
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
  -- Only a workspace the caller belongs to (viewers use Ask too).
  if p_workspace_id is not null and not public.is_member(p_workspace_id, 'viewer') then
    raise exception 'not a member of that workspace' using errcode = '42501';
  end if;

  insert into public.llm_usage
    (user_id, workspace_id, feature, model, input_tokens, output_tokens, cached_tokens,
     cost_usd, outcome, latency_ms, request_id, prompt_version)
  values
    (uid, p_workspace_id, p_feature, p_model, p_input_tokens, p_output_tokens, p_cached_tokens,
     p_cost_usd, p_outcome, p_latency_ms, p_request_id, p_prompt_version)
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.log_llm_usage(
  public.llm_feature, text, integer, integer, integer, numeric, public.llm_outcome, integer, text, text, uuid
) from public, anon;
grant execute on function public.log_llm_usage(
  public.llm_feature, text, integer, integer, integer, numeric, public.llm_outcome, integer, text, text, uuid
) to authenticated;

create policy "llm_usage: select as workspace owner"
  on public.llm_usage for select
  to authenticated
  using (workspace_id in (select public.my_workspaces('owner')));
