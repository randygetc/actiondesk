-- R-20 cleanup trigger: scheduled hourly, callable only by the database itself,
-- and a no-op until its Vault secrets exist.
begin;
\ir helpers/auth.psql
select plan(5);

select is(
  (select schedule from cron.job where jobname = 'attachment-cleanup'),
  '35 * * * *',
  'the cleanup runs hourly at minute 35'
);
select is(
  (select command from cron.job where jobname = 'attachment-cleanup'),
  'select public.invoke_attachment_cleanup()',
  'the cron job calls invoke_attachment_cleanup'
);

-- Without the Vault secrets, nothing is sent.
select lives_ok($$ select public.invoke_attachment_cleanup() $$, 'without secrets it returns quietly');
select is(
  (select count(*)::int from net.http_request_queue),
  0,
  '... and queues no HTTP request'
);

select tests.create_user('cleanup@example.com') as u \gset
select tests.authenticate_as(:'u');
select throws_ok(
  $$ select public.invoke_attachment_cleanup() $$,
  '42501', null,
  'a user cannot trigger the cleanup'
);

select * from finish();
rollback;
