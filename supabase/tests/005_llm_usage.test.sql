-- llm_usage: own-row select, append-only (no client writes), log_llm_usage()
-- always writes for the caller, llm_spend_recent() sums only the caller's last 24 hours.
begin;
\ir helpers/auth.psql
select plan(19);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- log_llm_usage -------------------------------------------------------------

select tests.authenticate_as(:'a');

select isnt(
  public.log_llm_usage('extract', 'claude-test', 100, 20, 0, 0.001234, 'ok', 850, 'req_1', 'extract-v1'),
  null,
  'owner: log_llm_usage returns the new id'
);
select results_eq(
  $$ select user_id, feature::text, input_tokens, output_tokens, cost_usd, outcome::text
       from public.llm_usage $$,
  format($$ values (%L::uuid, 'extract'::text, 100, 20, 0.001234::numeric, 'ok'::text) $$, :'a'),
  'the row belongs to the caller, with the values given'
);
select throws_ok(
  $$ select public.log_llm_usage('extract', 'm', -1, 0, 0, 0, 'ok', 0) $$,
  '23514', null,
  'negative token counts are rejected'
);
select throws_ok(
  $$ select public.log_llm_usage('extract', 'm', 0, 0, 0, -0.01, 'ok', 0) $$,
  '23514', null,
  'a negative cost is rejected'
);

select tests.authenticate_as(:'b');
select lives_ok(
  $$ select public.log_llm_usage('ask', 'claude-test', 10, 5, 0, 0.5, 'ok', 100) $$,
  'other user: logs their own usage'
);

-- select --------------------------------------------------------------------

select results_eq(
  $$ select count(*)::int from public.llm_usage $$,
  $$ values (1) $$,
  'other user: sees only their own row'
);
select results_eq(
  format($$ select count(*)::int from public.llm_usage where user_id = %L $$, :'a'),
  $$ values (0) $$,
  'other user: cannot see the owner''s usage'
);

-- append-only -----------------------------------------------------------------

select tests.authenticate_as(:'a');

select throws_ok(
  $$ insert into public.llm_usage (feature, model, outcome) values ('extract', 'm', 'ok') $$,
  '42501', null,
  'owner: cannot insert directly'
);
select throws_ok(
  $$ update public.llm_usage set cost_usd = 0 $$,
  '42501', null,
  'owner: cannot update (to lower their spend)'
);
select throws_ok(
  $$ delete from public.llm_usage $$,
  '42501', null,
  'owner: cannot delete (to reset their cap)'
);

-- llm_spend_recent (rolling 24 hours; step 2.8) ------------------------------

select tests.clear_authentication();
-- A row from 2 days ago (written as the table owner) is outside the window.
insert into public.llm_usage (user_id, feature, model, cost_usd, outcome, created_at)
  values (:'a', 'extract', 'm', 9, 'ok', now() - interval '2 days');
select tests.authenticate_as(:'a');

select results_eq(
  $$ select public.llm_spend_recent() $$,
  $$ values (0.001234::numeric) $$,
  'owner: recent spend counts only the last 24 hours of own rows'
);
select is(
  (select count(*)::int from pg_proc where proname = 'llm_spend_today'),
  0,
  'llm_spend_today (time zone based, resettable) is gone'
);

select tests.authenticate_as(:'b');
select results_eq(
  $$ select public.llm_spend_recent() $$,
  $$ values (0.5::numeric) $$,
  'other user: their spend excludes the owner''s rows'
);

-- anon ------------------------------------------------------------------------

select tests.authenticate_as_anon();

select throws_ok(
  $$ select count(*) from public.llm_usage $$,
  '42501', null,
  'anon: cannot read usage'
);
select throws_ok(
  $$ select public.log_llm_usage('extract', 'm', 0, 0, 0, 0, 'ok', 0) $$,
  '42501', null,
  'anon: cannot log usage'
);
select throws_ok(
  $$ select public.llm_spend_recent() $$,
  '42501', null,
  'anon: cannot read spend'
);

-- An authenticated role with no user id (e.g. a broken JWT) can't log either.
select tests.clear_authentication();
set local role authenticated;
select throws_ok(
  $$ select public.log_llm_usage('extract', 'm', 0, 0, 0, 0, 'ok', 0) $$,
  '42501', 'not authenticated',
  'no auth.uid(): log_llm_usage refuses'
);
reset role;

-- Structure -------------------------------------------------------------------

select is(
  (select relrowsecurity from pg_class where oid = 'public.llm_usage'::regclass),
  true,
  'RLS is enabled on llm_usage'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.llm_spend_recent()'::regprocedure),
  false,
  'llm_spend_recent is security invoker, so RLS applies'
);

select * from finish();
rollback;
