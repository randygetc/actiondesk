-- Step 2.8: fixes from the Phase 2 security review.

-- #2: the daily cap was measured from local midnight in the user's own,
-- user-editable time zone, so switching zones reset it. Use a rolling
-- 24-hour window instead, which no user setting affects.
drop function public.llm_spend_today(text);

create function public.llm_spend_recent()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(u.cost_usd), 0)
    from public.llm_usage u
   where u.user_id = (select auth.uid())
     and u.created_at >= now() - interval '24 hours';
$$;

revoke execute on function public.llm_spend_recent() from public, anon;
grant execute on function public.llm_spend_recent() to authenticated;

-- #6 (part): the admin page aggregated up to 10,000 raw rows in the app, so a
-- flood of rows could push real usage out of the report. Aggregate in SQL.
-- security invoker: admins see everyone's rows, others only their own (RLS).
create function public.llm_usage_report(p_tz text, p_days integer)
returns table (
  day date,
  feature public.llm_feature,
  calls bigint,
  users bigint,
  cost_usd numeric,
  input_tokens bigint,
  output_tokens bigint,
  cached_tokens bigint,
  capped bigint,
  failed bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'invalid time zone: %', p_tz using errcode = '22023';
  end if;
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'days must be 1 to 90' using errcode = '22023';
  end if;

  return query
    select (u.created_at at time zone p_tz)::date,
           u.feature,
           count(*),
           count(distinct u.user_id),
           sum(u.cost_usd),
           sum(u.input_tokens)::bigint,
           sum(u.output_tokens)::bigint,
           sum(u.cached_tokens)::bigint,
           count(*) filter (where u.outcome = 'capped'),
           count(*) filter (where u.outcome in ('error', 'invalid_output'))
      from public.llm_usage u
     where u.created_at >= now() - make_interval(days => p_days)
     group by 1, 2
     order by 1 desc, 2;
end;
$$;

revoke execute on function public.llm_usage_report(text, integer) from public, anon;
grant execute on function public.llm_usage_report(text, integer) to authenticated;

-- #7: users could upload straight to Storage (any name in their folder),
-- skipping the server's size and type checks and leaving objects with no row
-- to clean up. Only allow an object the server already recorded.
drop policy "attachments objects: insert own" on storage.objects;

create policy "attachments objects: insert recorded"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.attachments a
       where a.storage_path = name
         and a.owner_id = (select auth.uid())
    )
  );
