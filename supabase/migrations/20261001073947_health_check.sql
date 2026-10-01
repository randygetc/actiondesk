-- Step 3.10: a database probe for /api/health. Hosted Supabase allows the REST
-- root (/rest/v1/) only with a secret key, so the health check calls this
-- through PostgREST with the publishable key instead. It reads no data.
create function public.health_check()
returns boolean
language sql
stable
set search_path = ''
as $$ select true $$;

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated;
