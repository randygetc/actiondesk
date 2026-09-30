-- Step 2.6: app admins for the usage page (D-11). docs/plan.md §3.2.
-- The owner adds admins by SQL; there is no client write path.
--   insert into public.app_admins (user_id) values ('<uuid>');

create table public.app_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

revoke all on public.app_admins from anon, authenticated;
grant select on public.app_admins to authenticated;

create policy "app_admins: select own"
  on public.app_admins for select
  to authenticated
  using (user_id = (select auth.uid()));

-- security definer so policies on other tables can call it without the
-- caller needing to see app_admins; it only ever answers for auth.uid().
create function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins where user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- Admins read everyone's usage (the usage page). Still no writes for anyone.
create policy "llm_usage: select as admin"
  on public.llm_usage for select
  to authenticated
  using ((select public.is_app_admin()));
