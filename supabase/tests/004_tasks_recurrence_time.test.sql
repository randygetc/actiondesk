-- tasks.recurrence may carry the intended local time (BYHOUR/BYMINUTE), step 1.8.
begin;
\ir helpers/auth.psql
select plan(8);

select tests.create_user('a@example.com') as a \gset
select tests.authenticate_as(:'a');

select lives_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('a', now(), 'FREQ=DAILY;BYHOUR=2;BYMINUTE=30', 'America/Los_Angeles') $$,
  'a preset with a wall-clock time is accepted'
);
select lives_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('b', now(), 'FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=23;BYMINUTE=59', 'UTC'),
              ('c', now(), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=0;BYMINUTE=0', 'UTC') $$,
  'every preset shape takes the time suffix, including 00:00 and 23:59'
);
select lives_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('d', now(), 'FREQ=DAILY', 'UTC') $$,
  'the time suffix is optional'
);
select throws_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('x', now(), 'FREQ=DAILY;BYHOUR=24;BYMINUTE=0', 'UTC') $$,
  '23514', null, 'hour 24 is rejected'
);
select throws_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('x', now(), 'FREQ=DAILY;BYHOUR=2;BYMINUTE=60', 'UTC') $$,
  '23514', null, 'minute 60 is rejected'
);
select throws_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('x', now(), 'FREQ=DAILY;BYHOUR=02;BYMINUTE=30', 'UTC') $$,
  '23514', null, 'zero-padded values are rejected (one canonical form)'
);
select throws_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('x', now(), 'FREQ=DAILY;BYHOUR=2', 'UTC') $$,
  '23514', null, 'an hour without a minute is rejected'
);
select throws_ok(
  $$ insert into public.tasks (title, due_at, recurrence, recurrence_tz)
       values ('x', now(), 'FREQ=DAILY;BYMINUTE=30;BYHOUR=2', 'UTC') $$,
  '23514', null, 'parts in another order are rejected (one canonical form)'
);

select * from finish();
rollback;
