-- app_admins and the admin read path on llm_usage (step 2.6, D-11).
begin;
\ir helpers/auth.psql
select plan(13);

select tests.create_user('admin@example.com') as admin \gset
select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- As the table owner (the way the owner adds admins by SQL).
insert into public.app_admins (user_id) values (:'admin');
insert into public.llm_usage (user_id, feature, model, cost_usd, outcome)
  values (:'a', 'extract', 'm', 0.01, 'ok'), (:'b', 'ask', 'm', 0.02, 'ok');

-- admin ---------------------------------------------------------------------

select tests.authenticate_as(:'admin');

select is(public.is_app_admin(), true, 'admin: is_app_admin() is true');
select results_eq(
  format($$ select count(*)::int from public.llm_usage where user_id in (%L, %L) $$, :'a', :'b'),
  $$ values (2) $$,
  'admin: sees other users'' usage'
);
select results_eq(
  $$ select count(*)::int from public.app_admins $$,
  $$ values (1) $$,
  'admin: sees their own admin row'
);
select throws_ok(
  $$ delete from public.llm_usage $$,
  '42501', null,
  'admin: still cannot delete usage'
);
select throws_ok(
  format($$ insert into public.app_admins (user_id) values (%L) $$, :'a'),
  '42501', null,
  'admin: cannot add admins from the client'
);

-- non-admin -----------------------------------------------------------------

select tests.authenticate_as(:'a');

select is(public.is_app_admin(), false, 'non-admin: is_app_admin() is false');
select results_eq(
  $$ select user_id from public.llm_usage $$,
  format($$ values (%L::uuid) $$, :'a'),
  'non-admin: sees only their own usage'
);
select is_empty(
  $$ select 1 from public.app_admins $$,
  'non-admin: cannot see who the admins are'
);
select throws_ok(
  format($$ insert into public.app_admins (user_id) values (%L) $$, :'a'),
  '42501', null,
  'non-admin: cannot make themselves admin'
);
select throws_ok(
  $$ update public.app_admins set user_id = user_id $$,
  '42501', null,
  'non-admin: cannot update app_admins'
);

-- anon ----------------------------------------------------------------------

select tests.authenticate_as_anon();

select throws_ok(
  $$ select 1 from public.app_admins $$,
  '42501', null,
  'anon: cannot read app_admins'
);
select throws_ok(
  $$ select public.is_app_admin() $$,
  '42501', null,
  'anon: cannot call is_app_admin()'
);

select tests.clear_authentication();
select is(
  (select relrowsecurity from pg_class where oid = 'public.app_admins'::regclass),
  true,
  'RLS is enabled on app_admins'
);

select * from finish();
rollback;
