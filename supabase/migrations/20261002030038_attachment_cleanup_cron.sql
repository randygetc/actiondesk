-- R-20 (D-21): hourly cleanup of attachments older than 24 hours, for reviews
-- left open (a closed tab). The Edge Function `attachment-cleanup` deletes the
-- stored file through the Storage API and then the row; SQL alone would leave
-- the file in storage.
--
-- Same wiring as the digest: the function URL and the service key come from
-- Vault (`attachment_cleanup_function_url`, `service_role_key`), set per
-- environment (docs/deploy.md). Without them the call is skipped.

create function public.invoke_attachment_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := (select decrypted_secret from vault.decrypted_secrets where name = 'attachment_cleanup_function_url');
  key text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key');
begin
  if url is null or key is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.invoke_attachment_cleanup() from public, anon, authenticated;

-- Minute 35, away from the digest's minute 5.
select cron.schedule('attachment-cleanup', '35 * * * *', 'select public.invoke_attachment_cleanup()');
