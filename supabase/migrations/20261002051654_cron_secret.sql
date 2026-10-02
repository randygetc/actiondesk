-- Scheduled calls authenticate with a dedicated secret, not the service key.
-- Hosted Supabase injects a SUPABASE_SERVICE_ROLE_KEY into Edge Functions that
-- matches none of the project's listed keys, so the Vault copy could never
-- match and every scheduled call got 401 (found in prod, 2026-10-02).
--
-- Now: Vault `cron_secret` here, and the same value as the functions'
-- CRON_SECRET secret (supabase/functions/_shared/cron-auth.ts). The Vault
-- secret `service_role_key` is no longer read; delete it where it exists
-- (docs/deploy.md).

create or replace function public.invoke_digest()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := (select decrypted_secret from vault.decrypted_secrets where name = 'digest_function_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('mode', 'scheduled')
  );
end;
$$;

create or replace function public.invoke_attachment_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := (select decrypted_secret from vault.decrypted_secrets where name = 'attachment_cleanup_function_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

-- create or replace keeps the existing grants; restated to be explicit.
revoke execute on function public.invoke_digest() from public, anon, authenticated;
revoke execute on function public.invoke_attachment_cleanup() from public, anon, authenticated;
