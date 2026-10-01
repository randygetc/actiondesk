-- Weekly digest (step 3.6): who is due and when, no resend, data scoped to one
-- workspace, service_role-only functions, digest_runs visibility.
begin;
\ir helpers/auth.psql
select plan(14);

select tests.create_user('manila@example.com') as mnl \gset
select tests.create_user('la@example.com') as la \gset
select tests.create_user('outsider@example.com') as x \gset
update public.profiles set timezone = 'Asia/Manila' where id = :'mnl';
update public.profiles set timezone = 'America/Los_Angeles' where id = :'la';

select tests.authenticate_as(:'mnl');
select public.create_workspace('Team') as ws \gset
select tests.clear_authentication();
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws', :'la', 'viewer');

-- Mon 2026-10-05 08:05 in Manila = Mon 00:05 UTC = Sun 17:05 in Los Angeles.
\set mnl_monday '''2026-10-05 00:05:00+00'''
-- Mon 2026-10-05 08:05 in Los Angeles = 15:05 UTC.
\set la_monday '''2026-10-05 15:05:00+00'''

select results_eq(
  format($$ select user_id, week_start from public.digest_due(%L) where workspace_id = %L $$, :mnl_monday, :'ws'),
  format($$ values (%L::uuid, '2026-10-05'::date) $$, :'mnl'),
  'Manila Monday 08:05: only the Manila member is due, for their local Monday'
);
select results_eq(
  format($$ select user_id from public.digest_due(%L) where workspace_id = %L $$, :la_monday, :'ws'),
  format($$ values (%L::uuid) $$, :'la'),
  'Los Angeles Monday 08:05: the LA member (a viewer) is due'
);
select is_empty(
  format($$ select 1 from public.digest_due('2026-10-05 04:05:00+00') where workspace_id = %L $$, :'ws'),
  'Manila Monday 12:05: past the 08–11 window, nobody is due'
);
select is_empty(
  format($$ select 1 from public.digest_due('2026-10-06 00:05:00+00') where workspace_id = %L $$, :'ws'),
  'a Tuesday: nobody is due'
);

-- A sent run is never sent again; a failed one retries until 3 attempts.
insert into public.digest_runs (workspace_id, user_id, week_start, status, attempts)
  values (:'ws', :'mnl', '2026-10-05', 'failed', 1);
select isnt_empty(
  format($$ select 1 from public.digest_due(%L) where user_id = %L and workspace_id = %L $$, :mnl_monday, :'mnl', :'ws'),
  'a failed run is retried'
);
update public.digest_runs set attempts = 3 where user_id = :'mnl';
select is_empty(
  format($$ select 1 from public.digest_due(%L) where user_id = %L and workspace_id = %L $$, :mnl_monday, :'mnl', :'ws'),
  '... but not after 3 attempts'
);
update public.digest_runs set status = 'sent', attempts = 1 where user_id = :'mnl';
select is_empty(
  format($$ select 1 from public.digest_due(%L) where user_id = %L and workspace_id = %L $$, :mnl_monday, :'mnl', :'ws'),
  'a sent digest is not sent again'
);

-- A deleted workspace gets no digest.
update public.workspaces set deleted_at = now() where id = :'ws';
select is_empty(
  format($$ select 1 from public.digest_due(%L) where workspace_id = %L $$, :la_monday, :'ws'),
  'a deleted workspace is skipped'
);
update public.workspaces set deleted_at = null where id = :'ws';

-- digest_data is scoped to one workspace.
insert into public.tasks (workspace_id, owner_id, title, due_at)
  values (:'ws', :'mnl', 'Team overdue', '2026-10-01 00:00+00'),
         (tests.ws(:'x'), :'x', 'Outsider overdue', '2026-10-01 00:00+00');
select results_eq(
  format($$ select jsonb_path_query_array(public.digest_data(%L, 'Asia/Manila', %L), '$.overdue[*].title') $$, :'ws', :mnl_monday),
  $$ values ('["Team overdue"]'::jsonb) $$,
  'digest_data returns only this workspace''s tasks'
);

-- Only service_role may call the digest functions.
select tests.authenticate_as(:'mnl');
select throws_ok(
  $$ select * from public.digest_due() $$,
  '42501', null,
  'a user cannot list who is due'
);
select throws_ok(
  format($$ select public.digest_data(%L, 'UTC') $$, :'ws'),
  '42501', null,
  'a user (even an owner) cannot call digest_data'
);

-- digest_runs: own rows and owners' view; no client writes.
select isnt_empty($$ select 1 from public.digest_runs $$, 'recipient/owner: sees the run');
select throws_ok(
  format($$ update public.digest_runs set status = 'pending' where workspace_id = %L $$, :'ws'),
  '42501', null,
  'a user cannot change a run'
);
select tests.authenticate_as(:'x');
select is_empty($$ select 1 from public.digest_runs $$, 'outsider: sees no runs');

select * from finish();
rollback;
