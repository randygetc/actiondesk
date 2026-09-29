-- Step 1.5: profiles, one per auth user (docs/plan.md §2.1, §2.2).
-- DELIBERATE VIOLATION (step 1.4, #4): edited a committed migration. Do not merge.

-- Shared trigger function: keeps updated_at current on every update.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Rejects time zone names Postgres doesn't know. A CHECK constraint can't
-- use a subquery, so this is a trigger. Zod checks the same thing first.
create function public.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid time zone: %', new.timezone
      using errcode = '22023'; -- invalid_parameter_value
  end if;
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  timezone text not null default 'America/Los_Angeles',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger profiles_validate_timezone
  before insert or update of timezone on public.profiles
  for each row execute function public.validate_timezone();

-- Privileges. Rows are created by handle_new_user() and removed by the
-- auth.users cascade, so clients get no insert or delete. Only
-- display_name and timezone are updatable; id and timestamps are not.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, timezone) on public.profiles to authenticated;

create policy "profiles: select own row"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: update own row"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Creates the profile for each new auth user, seeding display_name from the
-- Google profile. security definer because the inserting role (supabase_auth_admin)
-- has no rights on public.profiles.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                               new.raw_user_meta_data ->> 'name')), ''), 100)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.validate_timezone() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
