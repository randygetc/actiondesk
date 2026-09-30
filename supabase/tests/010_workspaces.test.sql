-- Workspaces and roles (step 3.2, docs/plan.md §4.2–4.3): viewer reads,
-- member edits, owner manages; outsiders see nothing; no RLS recursion.
begin;
\ir helpers/auth.psql
select plan(38);

select tests.create_user('owner@example.com', '{"full_name":"Olive Owner"}') as o \gset
select tests.create_user('member@example.com', '{"full_name":"Mia Member"}') as m \gset
select tests.create_user('viewer@example.com', '{"full_name":"Vic Viewer"}') as v \gset
select tests.create_user('outsider@example.com', '{"full_name":"Oscar Outsider"}') as x \gset

-- New users get a Personal workspace (handle_new_user) -------------------------

select is(
  (select count(*)::int from public.workspace_members
    where user_id in (:'o', :'m', :'v', :'x') and role = 'owner'),
  4,
  'each new user owns a Personal workspace'
);

-- The owner creates a shared workspace and (as the DB owner, until 3.3 invites)
-- members are added.
select tests.authenticate_as(:'o');
select public.create_workspace('Team') as ws \gset
select tests.clear_authentication();
insert into public.workspace_members (workspace_id, user_id, role)
  values (:'ws', :'m', 'member'), (:'ws', :'v', 'viewer');
insert into public.projects (workspace_id, owner_id, name) values (:'ws', :'o', 'Launch') returning id as proj \gset
insert into public.tasks (workspace_id, owner_id, title, project_id) values (:'ws', :'o', 'Team task', :'proj') returning id as task \gset
insert into public.tasks (workspace_id, owner_id, title) values (tests.ws(:'x'), :'x', 'Outsider task') returning id as xtask \gset

-- viewer: read only ---------------------------------------------------------------

select tests.authenticate_as(:'v');
select results_eq(
  format($$ select title from public.tasks where workspace_id = %L $$, :'ws'),
  $$ values ('Team task') $$,
  'viewer: reads the workspace''s tasks'
);
select results_eq(
  format($$ select name from public.projects where workspace_id = %L $$, :'ws'),
  $$ values ('Launch') $$,
  'viewer: reads the workspace''s projects'
);
select throws_ok(
  format($$ insert into public.tasks (workspace_id, title) values (%L, 'Nope') $$, :'ws'),
  '42501', null,
  'viewer: cannot create a task'
);
select is_empty(
  format($$ update public.tasks set title = 'Changed' where id = %L returning id $$, :'task'),
  'viewer: cannot update a task'
);
select is_empty(
  format($$ delete from public.tasks where id = %L returning id $$, :'task'),
  'viewer: cannot delete a task'
);
select throws_ok(
  format($$ insert into public.projects (workspace_id, name) values (%L, 'Nope') $$, :'ws'),
  '42501', null,
  'viewer: cannot create a project'
);
select is(
  public.complete_task(:'task'),
  null,
  'viewer: complete_task changes nothing'
);
select results_eq(
  format($$ select status::text from public.tasks where id = %L $$, :'task'),
  $$ values ('todo') $$,
  'viewer: the task is still open'
);

-- member: edits ------------------------------------------------------------------

select tests.authenticate_as(:'m');
select lives_ok(
  format($$ insert into public.tasks (workspace_id, title, project_id) values (%L, 'Member task', %L) $$, :'ws', :'proj'),
  'member: creates a task in the workspace'
);
select results_eq(
  $$ select owner_id from public.tasks where title = 'Member task' $$,
  format($$ values (%L::uuid) $$, :'m'),
  'member: owner_id records the creator'
);
select isnt_empty(
  format($$ update public.tasks set title = 'Team task (edited)' where id = %L returning id $$, :'task'),
  'member: updates another member''s task'
);
select lives_ok(
  format($$ insert into public.projects (workspace_id, name) values (%L, 'Hiring') $$, :'ws'),
  'member: creates a project'
);
select throws_ok(
  format($$ insert into public.projects (workspace_id, name) values (%L, 'launch') $$, :'ws'),
  '23505', null,
  'project names are unique per workspace, case-insensitive'
);
select throws_ok(
  format($$ insert into public.tasks (workspace_id, owner_id, title) values (%L, %L, 'Forged') $$, :'ws', :'o'),
  '42501', null,
  'member: cannot create a task as someone else'
);
select lives_ok(
  format($$ update public.tasks set assignee_id = %L where id = %L $$, :'v', :'task'),
  'member: assigns a task to a workspace member'
);
select throws_ok(
  format($$ update public.tasks set assignee_id = %L where id = %L $$, :'x', :'task'),
  '23514', null,
  'member: cannot assign a task to a non-member'
);
select is_empty(
  format($$ update public.workspace_members set role = 'owner' where workspace_id = %L and user_id = %L returning user_id $$, :'ws', :'m'),
  'member: cannot promote themselves'
);
select is_empty(
  format($$ delete from public.workspace_members where workspace_id = %L and user_id = %L returning user_id $$, :'ws', :'v'),
  'member: cannot remove another member'
);
select is_empty(
  format($$ update public.workspaces set name = 'Mine now' where id = %L returning id $$, :'ws'),
  'member: cannot rename the workspace'
);

-- cross-workspace ---------------------------------------------------------------

select throws_ok(
  format($$ insert into public.tasks (workspace_id, title, project_id) values (%L, 'Split', %L) $$, tests.ws(:'m'), :'proj'),
  '23503', null,
  'a task cannot point at a project in another workspace'
);
select is_empty(
  format($$ select 1 from public.tasks where id = %L $$, :'xtask'),
  'member: cannot see another workspace''s task'
);

-- owner: manages ------------------------------------------------------------------

select tests.authenticate_as(:'o');
select isnt_empty(
  format($$ update public.workspaces set name = 'Team HQ' where id = %L returning id $$, :'ws'),
  'owner: renames the workspace'
);
select isnt_empty(
  format($$ update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L returning user_id $$, :'ws', :'v'),
  'owner: changes a role'
);
select throws_ok(
  format($$ update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L $$, :'ws', :'o'),
  '23514', null,
  'the last owner cannot demote themselves'
);
select throws_ok(
  format($$ delete from public.workspace_members where workspace_id = %L and user_id = %L $$, :'ws', :'o'),
  '23514', null,
  'the last owner cannot leave'
);
select results_eq(
  format($$ select count(*)::int from public.workspace_members where workspace_id = %L $$, :'ws'),
  $$ values (3) $$,
  'owner: sees every member (and reading members does not recurse)'
);
select results_eq(
  $$ select display_name from public.profiles order by display_name $$,
  $$ values ('Mia Member'), ('Olive Owner'), ('Vic Viewer') $$,
  'owner: sees co-members'' names, not outsiders'''
);

-- member leaves -----------------------------------------------------------------

select tests.authenticate_as(:'m');
select isnt_empty(
  format($$ delete from public.workspace_members where workspace_id = %L and user_id = %L returning user_id $$, :'ws', :'m'),
  'member: can leave'
);
select is_empty(
  format($$ select 1 from public.tasks where workspace_id = %L $$, :'ws'),
  'after leaving: sees none of the workspace''s tasks'
);

-- outsider -------------------------------------------------------------------------

select tests.authenticate_as(:'x');
select is_empty(format($$ select 1 from public.workspaces where id = %L $$, :'ws'), 'outsider: cannot see the workspace');
select is_empty(format($$ select 1 from public.workspace_members where workspace_id = %L $$, :'ws'), 'outsider: cannot see its members');
select is_empty(format($$ select 1 from public.projects where workspace_id = %L $$, :'ws'), 'outsider: cannot see its projects');
select is(public.is_member(:'ws', 'viewer'), false, 'outsider: is_member is false');
select throws_ok(
  format($$ select public.log_llm_usage('extract', 'm', 1, 1, 0, 0, 'ok', 1, null, null, %L) $$, :'ws'),
  '42501', null,
  'outsider: cannot log usage against the workspace'
);
select throws_ok(
  format($$ insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'owner') $$, :'ws', :'x'),
  '42501', null,
  'outsider: cannot add themselves'
);

-- usage: workspace owners read their workspace's rows ------------------------------

select tests.authenticate_as(:'v');
select public.log_llm_usage('ask', 'm', 1, 1, 0, 0.01, 'ok', 1, null, null, :'ws');
select tests.authenticate_as(:'o');
select results_eq(
  format($$ select count(*)::int from public.llm_usage where workspace_id = %L $$, :'ws'),
  $$ values (1) $$,
  'owner: reads usage logged in their workspace'
);

-- anon -----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.workspaces $$, '42501', null, 'anon: cannot read workspaces');

select * from finish();
rollback;
