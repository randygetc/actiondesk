-- projects: own-row RLS for every operation, column privileges, constraints.
begin;
\ir helpers/auth.psql
select plan(25);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- Seed one project for B as the superuser.
insert into public.projects (workspace_id, owner_id, name) values (tests.ws(:'b'), :'b', 'B project') returning id as b_project \gset

-- insert ------------------------------------------------------------------

select tests.authenticate_as(:'a');

select lives_ok(
  $$ insert into public.projects (workspace_id, name) values (tests.ws(), 'Launch') $$,
  'owner: can create a project'
);
select is(
  (select owner_id from public.projects where name = 'Launch'),
  :'a'::uuid,
  'owner_id defaults to the signed-in user'
);
select throws_ok(
  format($$ insert into public.projects (workspace_id, owner_id, name) values (tests.ws(), %L, 'Sneaky') $$, :'b'),
  '42501', null,
  'other user: cannot create a project owned by someone else'
);
select throws_ok(
  $$ insert into public.projects (workspace_id, name) values (tests.ws(), 'launch') $$,
  '23505', null,
  'duplicate name (case-insensitive) is rejected'
);
select throws_ok(
  $$ insert into public.projects (workspace_id, name) values (tests.ws(), '') $$,
  '23514', null,
  'empty name is rejected'
);
select throws_ok(
  $$ insert into public.projects (workspace_id, name) values (tests.ws(), '  padded  ') $$,
  '23514', null,
  'untrimmed name is rejected'
);
select throws_ok(
  format($$ insert into public.projects (workspace_id, name) values (tests.ws(), %L) $$, repeat('x', 101)),
  '23514', null,
  'name over 100 characters is rejected'
);
select lives_ok(
  $$ insert into public.projects (workspace_id, name) values (tests.ws(), 'B project') $$,
  'the same name is fine for a different user'
);

select id as a_project from public.projects where name = 'Launch' \gset

-- select ------------------------------------------------------------------

select results_eq(
  $$ select name from public.projects order by name $$,
  $$ values ('B project'::text), ('Launch'::text) $$,
  'owner: sees only their own projects'
);
select is_empty(
  format($$ select 1 from public.projects where id = %L $$, :'b_project'),
  'other user: another user''s project is invisible'
);

-- update ------------------------------------------------------------------

select lives_ok(
  format($$ update public.projects set name = 'Launch v2' where id = %L $$, :'a_project'),
  'owner: can rename'
);
select lives_ok(
  format($$ update public.projects set archived_at = now() where id = %L $$, :'a_project'),
  'owner: can archive'
);
select isnt(
  (select archived_at from public.projects where id = :'a_project'),
  null,
  'archived_at is set'
);
select is_empty(
  format($$ update public.projects set name = 'Hijacked' where id = %L returning 1 $$, :'b_project'),
  'other user: updating another user''s project affects 0 rows'
);
select throws_ok(
  format($$ update public.projects set owner_id = %L where id = %L $$, :'b', :'a_project'),
  '42501', null,
  'owner: cannot change owner_id'
);
select throws_ok(
  format($$ update public.projects set id = gen_random_uuid() where id = %L $$, :'a_project'),
  '42501', null,
  'owner: cannot change id'
);
select throws_ok(
  format($$ update public.projects set created_at = now() where id = %L $$, :'a_project'),
  '42501', null,
  'owner: cannot change created_at'
);

-- delete ------------------------------------------------------------------

select is_empty(
  format($$ delete from public.projects where id = %L returning 1 $$, :'b_project'),
  'other user: deleting another user''s project affects 0 rows'
);
select results_eq(
  format($$ delete from public.projects where id = %L returning name $$, :'a_project'),
  $$ values ('Launch v2'::text) $$,
  'owner: can delete'
);

select tests.clear_authentication();
select is(
  (select name from public.projects where id = :'b_project'),
  'B project',
  'other user''s project is unchanged and not deleted'
);

-- anon --------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.projects $$, '42501', null, 'anon: cannot select');
select throws_ok($$ insert into public.projects (workspace_id, name) values (tests.ws(), 'x') $$, '42501', null, 'anon: cannot insert');
select throws_ok($$ update public.projects set name = 'x' $$, '42501', null, 'anon: cannot update');
select throws_ok($$ delete from public.projects $$, '42501', null, 'anon: cannot delete');
select tests.clear_authentication();

-- cascade -----------------------------------------------------------------

delete from auth.users where id = :'b';
select is_empty(
  format($$ select 1 from public.projects where owner_id = %L $$, :'b'),
  'deleting the user deletes their projects'
);

select * from finish();
rollback;
