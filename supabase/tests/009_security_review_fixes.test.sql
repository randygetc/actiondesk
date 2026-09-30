-- Step 2.8 security review fixes: rolling-window cap, SQL usage report,
-- storage uploads only for recorded attachments.
begin;
\ir helpers/auth.psql
select plan(10);

select tests.create_user('admin@example.com') as admin \gset
select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset
select gen_random_uuid() as att \gset

insert into public.app_admins (user_id) values (:'admin');
insert into public.llm_usage (user_id, feature, model, cost_usd, outcome, created_at) values
  (:'a', 'extract', 'm', 0.40, 'ok',     now() - interval '23 hours'),
  (:'a', 'extract', 'm', 0.70, 'ok',     now() - interval '25 hours'),
  (:'a', 'ask',     'm', 0.00, 'capped', now()),
  (:'b', 'ask',     'm', 0.10, 'error',  now());

-- rolling window: the time zone plays no part, so it can't be switched to reset.
select tests.authenticate_as(:'a');
select results_eq(
  $$ select public.llm_spend_recent() $$,
  $$ values (0.40::numeric) $$,
  'recent spend: 23 hours ago counts, 25 hours ago does not'
);

-- usage report --------------------------------------------------------------
select results_eq(
  $$ select sum(calls)::int, sum(cost_usd) from public.llm_usage_report('UTC', 30) $$,
  $$ values (3, 1.10::numeric) $$,
  'non-admin: the report covers only their own rows'
);
select throws_ok(
  $$ select * from public.llm_usage_report('Nowhere/City', 30) $$,
  '22023', null,
  'report: invalid time zone rejected'
);
select throws_ok(
  $$ select * from public.llm_usage_report('UTC', 365) $$,
  '22023', null,
  'report: more than 90 days rejected'
);

select tests.authenticate_as(:'admin');
select results_eq(
  $$ select sum(calls)::int, sum(capped)::int, sum(failed)::int
       from public.llm_usage_report('UTC', 30) $$,
  $$ select count(*)::int,
            count(*) filter (where outcome = 'capped')::int,
            count(*) filter (where outcome in ('error', 'invalid_output'))::int
       from public.llm_usage where created_at >= now() - interval '30 days' $$,
  'admin: the report aggregates every user''s rows'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.llm_usage_report('UTC', 30) $$,
  '42501', null,
  'anon: cannot run the report'
);

-- storage: only objects the server recorded ---------------------------------
select tests.authenticate_as(:'a');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('attachments', %L) $$,
         :'a' || '/unrecorded.pdf'),
  '42501', null,
  'owner: cannot upload an object with no attachments row'
);
insert into public.attachments (id, storage_path, mime_type, size_bytes)
  values (:'att', :'a' || '/' || :'att' || '.pdf', 'application/pdf', 100);
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('attachments', %L) $$,
         :'a' || '/' || :'att' || '.pdf'),
  'owner: can upload the object for a recorded attachment'
);

select tests.authenticate_as(:'b');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('attachments', %L) $$,
         :'a' || '/' || :'att' || '.pdf'),
  '42501', null,
  'other user: cannot upload to another user''s recorded path'
);
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('attachments', %L) $$,
         :'b' || '/' || :'att' || '.pdf'),
  '42501', null,
  'other user: cannot reuse another user''s attachment id in their own folder'
);

select * from finish();
rollback;
