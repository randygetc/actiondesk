-- profiles: trigger-created rows, own-row RLS, column privileges, time zone validation.
begin;
\ir helpers/auth.psql
select plan(22);

select tests.create_user('a@example.com', '{"full_name": "Alice A"}') as a \gset
select tests.create_user('b@example.com', '{"name": "Bob"}') as b \gset
select tests.create_user('c@example.com') as c \gset
select tests.create_user('long@example.com', jsonb_build_object('full_name', repeat('x', 150))) as long \gset

-- handle_new_user ---------------------------------------------------------

select results_eq(
  format($$ select display_name, timezone from public.profiles where id = %L $$, :'a'),
  $$ values ('Alice A'::text, 'America/Los_Angeles'::text) $$,
  'new user gets one profile with full_name and the default time zone'
);
select is(
  (select display_name from public.profiles where id = :'b'),
  'Bob',
  'display_name falls back to the "name" claim'
);
select is(
  (select display_name from public.profiles where id = :'c'),
  null,
  'display_name is null when the provider sends no name'
);
select is(
  (select count(*)::int from public.profiles where id in (:'a', :'b', :'c')),
  3,
  'exactly one profile per user'
);
select is(
  (select char_length(display_name) from public.profiles where id = :'long'),
  100,
  'an over-long provider name is truncated to 100 characters'
);
select ok(
  not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
  and not has_function_privilege('anon', 'public.handle_new_user()', 'execute'),
  'clients cannot call handle_new_user() directly'
);

-- select ------------------------------------------------------------------

select tests.authenticate_as(:'a');
select results_eq(
  $$ select id from public.profiles $$,
  format($$ values (%L::uuid) $$, :'a'),
  'owner: sees exactly their own profile'
);
select is_empty(
  format($$ select 1 from public.profiles where id = %L $$, :'b'),
  'other user: another user''s profile is invisible'
);

-- update ------------------------------------------------------------------

select lives_ok(
  $$ update public.profiles set timezone = 'Europe/Berlin', display_name = 'Al'
       where id = (select auth.uid()) $$,
  'owner: can update display_name and timezone'
);
select results_eq(
  $$ select timezone, display_name from public.profiles $$,
  $$ values ('Europe/Berlin'::text, 'Al'::text) $$,
  'owner: the update is visible'
);
select is_empty(
  format($$ update public.profiles set timezone = 'Asia/Tokyo' where id = %L returning 1 $$, :'b'),
  'other user: updating another user''s profile affects 0 rows'
);
select throws_ok(
  format($$ update public.profiles set id = %L where id = %L $$, :'b', :'a'),
  '42501', null,
  'owner: cannot update id'
);
select throws_ok(
  $$ update public.profiles set created_at = now() - interval '1 day' $$,
  '42501', null,
  'owner: cannot update created_at'
);
select throws_ok(
  $$ update public.profiles set timezone = 'Mars/Olympus_Mons' $$,
  '22023', null,
  'invalid time zone is rejected by the database'
);

-- insert and delete (no policies, no grants) --------------------------------

select throws_ok(
  format($$ insert into public.profiles (id) values (%L) $$, :'a'),
  '42501', null,
  'owner: cannot insert a profile'
);
select throws_ok(
  $$ delete from public.profiles $$,
  '42501', null,
  'owner: cannot delete a profile'
);

select tests.clear_authentication();
select is(
  (select timezone from public.profiles where id = :'b'),
  'America/Los_Angeles',
  'other user''s profile is unchanged'
);

-- anon --------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon: cannot select');
select throws_ok($$ update public.profiles set timezone = 'UTC' $$, '42501', null, 'anon: cannot update');
select throws_ok(
  format($$ insert into public.profiles (id) values (%L) $$, :'c'),
  '42501', null, 'anon: cannot insert'
);
select tests.clear_authentication();

-- updated_at and cascade ----------------------------------------------------

update public.profiles set updated_at = '2000-01-01' where id = :'b';
update public.profiles set display_name = 'Robert' where id = :'b';
select ok(
  (select updated_at > '2000-01-01' from public.profiles where id = :'b'),
  'updated_at is refreshed on update'
);

delete from auth.users where id = :'c';
select is_empty(
  format($$ select 1 from public.profiles where id = %L $$, :'c'),
  'deleting the auth user deletes the profile'
);

select * from finish();
rollback;
