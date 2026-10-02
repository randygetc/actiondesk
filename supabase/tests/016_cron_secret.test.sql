-- Scheduled calls send the Vault `cron_secret`, never the service key.
begin;
select plan(5);

select vault.create_secret('http://example.invalid/functions/v1/attachment-cleanup', 'attachment_cleanup_function_url');
select vault.create_secret('http://example.invalid/functions/v1/digest', 'digest_function_url');
select vault.create_secret('old-service-key-should-not-be-sent', 'service_role_key');

-- Only the old service key: nothing is sent.
select public.invoke_attachment_cleanup();
select public.invoke_digest();
select is((select count(*)::int from net.http_request_queue), 0,
  'with only service_role_key in Vault, nothing is sent');

select vault.create_secret('test-cron-secret-0123456789abcdefghij', 'cron_secret');
select public.invoke_attachment_cleanup();
select public.invoke_digest();
select is((select count(*)::int from net.http_request_queue), 2,
  'with cron_secret, both jobs send a request');
select is(
  (select count(*)::int from net.http_request_queue
    where headers->>'Authorization' = 'Bearer test-cron-secret-0123456789abcdefghij'),
  2,
  'both send Bearer <cron_secret>'
);
select is(
  (select count(*)::int from net.http_request_queue where headers::text like '%old-service-key%'),
  0,
  'the service key is never sent'
);
select is(
  (select convert_from(body, 'utf8')::jsonb from net.http_request_queue where url like '%/digest'),
  '{"mode":"scheduled"}'::jsonb,
  'the digest call asks for the scheduled run'
);

select * from finish();
rollback;
