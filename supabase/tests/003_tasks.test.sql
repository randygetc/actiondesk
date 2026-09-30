-- tasks: own-row RLS per operation, cross-owner project FK, derived columns,
-- constraints, complete_task() idempotency, project delete behaviour.
begin;
\ir helpers/auth.psql
select plan(46);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

insert into public.projects (owner_id, name) values (:'a', 'A project') returning id as pa \gset
insert into public.projects (owner_id, name) values (:'b', 'B project') returning id as pb \gset
insert into public.tasks (owner_id, title, due_at, recurrence, recurrence_tz)
  values (:'b', 'B task', '2026-10-06 16:00+00', 'FREQ=DAILY', 'America/Los_Angeles')
  returning id as tb \gset

-- insert ------------------------------------------------------------------

select tests.authenticate_as(:'a');

select lives_ok(
  $$ insert into public.tasks (title) values ('Plain') $$,
  'owner: can create a task'
);
select results_eq(
  $$ select owner_id, status::text, priority::text, completed_at, series_id
       from public.tasks where title = 'Plain' $$,
  format($$ values (%L::uuid, 'todo'::text, 'normal'::text, null::timestamptz, null::uuid) $$, :'a'),
  'defaults: owner is the user, todo, normal, not completed, no series'
);
select lives_ok(
  format($$ insert into public.tasks (title, project_id) values ('In project', %L) $$, :'pa'),
  'owner: can create a task in their own project'
);
select throws_ok(
  format($$ insert into public.tasks (title, project_id) values ('Sneaky', %L) $$, :'pb'),
  '23503', null,
  'cannot create a task in another user''s project (composite FK)'
);
select throws_ok(
  format($$ insert into public.tasks (owner_id, title) values (%L, 'Sneaky') $$, :'b'),
  '42501', null,
  'cannot set owner_id'
);
select throws_ok(
  $$ insert into public.tasks (title, completed_at) values ('x', now()) $$,
  '42501', null,
  'cannot set completed_at directly'
);
select throws_ok(
  format($$ insert into public.tasks (title, due_at, recurrence, recurrence_tz, series_id)
            values ('Hijack', now(), 'FREQ=DAILY', 'UTC', %L) $$, :'tb'),
  '42501', null,
  'cannot attach a task to another user''s series'
);

-- constraints -------------------------------------------------------------

select throws_ok($$ insert into public.tasks (title) values ('') $$, '23514', null, 'empty title rejected');
select throws_ok($$ insert into public.tasks (title) values (' x ') $$, '23514', null, 'untrimmed title rejected');
select throws_ok(
  format($$ insert into public.tasks (title) values (%L) $$, repeat('x', 201)),
  '23514', null, 'title over 200 characters rejected'
);
select throws_ok(
  format($$ insert into public.tasks (title, notes) values ('x', %L) $$, repeat('x', 10001)),
  '23514', null, 'notes over 10,000 characters rejected'
);
select throws_ok(
  $$ insert into public.tasks (title, recurrence, recurrence_tz) values ('x', 'FREQ=DAILY', 'UTC') $$,
  '23514', null, 'recurrence without a due date rejected'
);
select throws_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('x', now(), 'FREQ=YEARLY', 'UTC') $$,
  '23514', null, 'recurrence outside the presets rejected'
);
select throws_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('x', now(), 'FREQ=DAILY', 'Mars/Olympus_Mons') $$,
  '22023', null, 'invalid recurrence_tz rejected'
);
select throws_ok(
  $$ insert into public.tasks (title, due_at, recurrence) values ('x', now(), 'FREQ=DAILY') $$,
  '23514', null, 'recurrence without recurrence_tz rejected'
);

-- A recurring task, due Tue 2026-10-06 09:00 Pacific.
insert into public.tasks (title, due_at, recurrence, recurrence_tz, project_id)
  values ('Standup', '2026-10-06 16:00+00', 'FREQ=WEEKLY;BYDAY=TU', 'America/Los_Angeles', :'pa')
  returning id as ta \gset
select is(
  (select series_id from public.tasks where id = :'ta'),
  :'ta'::uuid,
  'a recurring task starts its own series'
);
select lives_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('Weekdays', now(), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'UTC'),
              ('Every 2 weeks', now(), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', 'UTC'),
              ('Monthly 15th', now(), 'FREQ=MONTHLY;BYMONTHDAY=15', 'UTC'),
              ('Monthly last day', now(), 'FREQ=MONTHLY;BYMONTHDAY=-1', 'UTC'),
              ('2nd Tuesday', now(), 'FREQ=MONTHLY;BYDAY=2TU', 'UTC'),
              ('Last Friday', now(), 'FREQ=MONTHLY;BYDAY=-1FR', 'UTC') $$,
  'every preset shape is accepted'
);

-- select ------------------------------------------------------------------

select is(
  (select count(*)::int from public.tasks where owner_id <> (select auth.uid())),
  0,
  'owner: sees none of another user''s tasks'
);
select is_empty(
  format($$ select 1 from public.tasks where id = %L $$, :'tb'),
  'other user: another user''s task is invisible'
);

-- update ------------------------------------------------------------------

select id as plain from public.tasks where title = 'Plain' \gset
update public.tasks set status = 'done' where id = :'plain';
select isnt(
  (select completed_at from public.tasks where id = :'plain'),
  null,
  'moving to done sets completed_at'
);
update public.tasks set status = 'todo' where id = :'plain';
select is(
  (select completed_at from public.tasks where id = :'plain'),
  null,
  'moving back to todo clears completed_at'
);
select throws_ok(
  format($$ update public.tasks set project_id = %L where id = %L $$, :'pb', :'plain'),
  '23503', null,
  'cannot move a task into another user''s project'
);
select is_empty(
  format($$ update public.tasks set title = 'Hijacked' where id = %L returning 1 $$, :'tb'),
  'other user: updating another user''s task affects 0 rows'
);
select throws_ok(
  format($$ update public.tasks set completed_at = now() where id = %L $$, :'plain'),
  '42501', null, 'cannot update completed_at directly'
);
select throws_ok(
  format($$ update public.tasks set series_id = gen_random_uuid() where id = %L $$, :'plain'),
  '42501', null, 'cannot update series_id'
);
select throws_ok(
  format($$ update public.tasks set owner_id = %L where id = %L $$, :'b', :'plain'),
  '42501', null, 'cannot update owner_id'
);

-- complete_task -------------------------------------------------------------

select isnt(
  public.complete_task(:'ta', '2026-10-13 16:00+00'),
  null,
  'completing a recurring task returns the next occurrence'
);
select results_eq(
  format($$ select status::text, due_at, project_id from public.tasks
             where series_id = %L order by due_at $$, :'ta'),
  format($$ values ('done'::text, '2026-10-06 16:00+00'::timestamptz, %L::uuid),
                   ('todo'::text, '2026-10-13 16:00+00'::timestamptz, %L::uuid) $$, :'pa', :'pa'),
  'the task is done and exactly one next occurrence exists, in the same project'
);
select is(
  public.complete_task(:'ta', '2026-10-13 16:00+00'),
  null,
  'completing again (double submit) does nothing'
);
select is(
  (select count(*)::int from public.tasks where series_id = :'ta'),
  2,
  'still exactly two tasks in the series'
);
update public.tasks set status = 'todo' where id = :'ta';
select is(
  (select count(*)::int from public.tasks where series_id = :'ta'),
  2,
  'reopening keeps the next occurrence (D-7)'
);
select is(
  public.complete_task(:'ta', '2026-10-13 16:00+00'),
  null,
  'completing the reopened task does not duplicate the next occurrence'
);
select is(
  (select count(*)::int from public.tasks where series_id = :'ta' and status = 'todo'),
  1,
  'one open occurrence in the series'
);
select is(
  public.complete_task(:'plain', null),
  null,
  'completing a non-recurring task returns null'
);
select is(
  (select status::text from public.tasks where id = :'plain'),
  'done',
  'the non-recurring task is done'
);
select is(
  public.complete_task(:'tb', '2026-10-07 16:00+00'),
  null,
  'complete_task on another user''s task affects nothing'
);

-- delete ------------------------------------------------------------------

select is_empty(
  format($$ delete from public.tasks where id = %L returning 1 $$, :'tb'),
  'other user: deleting another user''s task affects 0 rows'
);
select results_eq(
  format($$ delete from public.tasks where id = %L returning title $$, :'plain'),
  $$ values ('Plain'::text) $$,
  'owner: can delete'
);

-- project delete keeps tasks (D-3) -------------------------------------------

delete from public.projects where id = :'pa';
select results_eq(
  format($$ select count(*)::int, count(project_id)::int from public.tasks where series_id = %L $$, :'ta'),
  $$ values (2, 0) $$,
  'deleting a project keeps its tasks with no project'
);

select tests.clear_authentication();
select results_eq(
  format($$ select status::text, (select count(*)::int from public.tasks where series_id = %L)
             from public.tasks where id = %L $$, :'tb', :'tb'),
  $$ values ('todo'::text, 1) $$,
  'other user''s task and series are untouched'
);

-- anon --------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.tasks $$, '42501', null, 'anon: cannot select');
select throws_ok($$ insert into public.tasks (title) values ('x') $$, '42501', null, 'anon: cannot insert');
select throws_ok($$ update public.tasks set title = 'x' $$, '42501', null, 'anon: cannot update');
select throws_ok($$ delete from public.tasks $$, '42501', null, 'anon: cannot delete');
select throws_ok(
  format($$ select public.complete_task(%L, null) $$, :'tb'),
  '42501', null, 'anon: cannot call complete_task'
);
select tests.clear_authentication();

-- cascade -----------------------------------------------------------------

delete from auth.users where id = :'b';
select is_empty(
  format($$ select 1 from public.tasks where owner_id = %L $$, :'b'),
  'deleting the user deletes their tasks'
);

select * from finish();
rollback;
