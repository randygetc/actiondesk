-- Step 3.6: weekly AI digest (docs/plan.md §4.6; D-26 Resend, D-27 every member).
-- Mondays 08:00 in each recipient's time zone. An hourly cron job calls the
-- `digest` Edge Function, which uses the admin client (ADR-0003) and these
-- service_role-only functions, each scoped to one workspace.

alter type public.llm_feature add value if not exists 'digest';

create type public.digest_status as enum ('pending', 'sent', 'skipped', 'failed');

-- One row per recipient per workspace per week: a resumed or repeated batch
-- never sends twice (unique key, plus the email's idempotency key).
create table public.digest_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null, -- the recipient's local Monday
  status public.digest_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  error_code text check (char_length(error_code) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, week_start)
);

create trigger digest_runs_set_updated_at
  before update on public.digest_runs
  for each row execute function public.set_updated_at();

alter table public.digest_runs enable row level security;

-- Recipients see their own runs; owners see their workspace's. Only the
-- Edge Function (service_role) writes.
revoke all on public.digest_runs from anon, authenticated;
grant select on public.digest_runs to authenticated;

create policy "digest_runs: select own or as owner"
  on public.digest_runs for select to authenticated
  using (
    user_id = (select auth.uid())
    or workspace_id in (select public.my_workspaces('owner'))
  );

-- Recipients whose local time is Monday 08:00–11:59 and who haven't had this
-- week's digest yet. The hourly job reaches each recipient at 8:05; the next
-- three hours are for retries (at most 3 attempts), so a failure mid-batch
-- resumes instead of waiting a week.
create function public.digest_due(p_now timestamptz default now())
returns table (workspace_id uuid, user_id uuid, email text, timezone text, week_start date)
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id, m.user_id, u.email::text, p.timezone,
         (p_now at time zone p.timezone)::date as week_start
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
   where extract(isodow from p_now at time zone p.timezone) = 1
     and extract(hour from p_now at time zone p.timezone) between 8 and 11
     and u.email is not null
     and not exists (
       select 1 from public.digest_runs r
        where r.workspace_id = m.workspace_id
          and r.user_id = m.user_id
          and r.week_start = (p_now at time zone p.timezone)::date
          and (r.status in ('sent', 'skipped') or r.attempts >= 3)
     );
$$;

-- The week's tasks for one workspace, in the recipient's time zone: completed
-- in the last 7 days, overdue, and due in the next 7. Titles only, capped.
create function public.digest_data(p_workspace_id uuid, p_tz text, p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select title, status, due_at, completed_at, (select name from public.projects p where p.id = project_id) as project
      from public.tasks
     where workspace_id = p_workspace_id
  )
  select jsonb_build_object(
    'workspace', (select name from public.workspaces where id = p_workspace_id),
    'completed', coalesce((
      select jsonb_agg(jsonb_build_object('title', title, 'project', project) order by completed_at desc)
        from (select * from t where completed_at >= p_now - interval '7 days' order by completed_at desc limit 30) x), '[]'::jsonb),
    'overdue', coalesce((
      select jsonb_agg(jsonb_build_object('title', title, 'project', project,
               'due', to_char(due_at at time zone p_tz, 'YYYY-MM-DD')) order by due_at)
        from (select * from t where status <> 'done' and due_at < p_now order by due_at limit 30) x), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object('title', title, 'project', project,
               'due', to_char(due_at at time zone p_tz, 'YYYY-MM-DD')) order by due_at)
        from (select * from t where status <> 'done' and due_at >= p_now
                and due_at < p_now + interval '7 days' order by due_at limit 30) x), '[]'::jsonb)
  );
$$;

revoke execute on function public.digest_due(timestamptz) from public, anon, authenticated;
revoke execute on function public.digest_data(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.digest_due(timestamptz) to service_role;
grant execute on function public.digest_data(uuid, text, timestamptz) to service_role;

-- Hourly trigger. The function URL and service key come from Vault
-- (secrets `digest_function_url`, `service_role_key`), set per environment in
-- docs/deploy.md (step 3.10). Without them the call is skipped.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function public.invoke_digest()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := (select decrypted_secret from vault.decrypted_secrets where name = 'digest_function_url');
  key text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key');
begin
  if url is null or key is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('mode', 'scheduled')
  );
end;
$$;

revoke execute on function public.invoke_digest() from public, anon, authenticated;

select cron.schedule('weekly-digest', '5 * * * *', 'select public.invoke_digest()');
