-- Step 3.5: deleting a workspace or removing a member needs aal2 (TOTP).
begin;
\ir helpers/auth.psql
select plan(11);

select tests.create_user('owner@example.com') as o \gset
select tests.create_user('member@example.com') as m \gset

select tests.authenticate_as(:'o');
select public.create_workspace('Team') as ws \gset
select tests.clear_authentication();
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws', :'m', 'member');

-- aal1 owner ----------------------------------------------------------------------

select tests.authenticate_as(:'o', 'aal1');
select is_empty(
  format($$ delete from public.workspace_members where workspace_id = %L and user_id = %L returning user_id $$, :'ws', :'m'),
  'aal1 owner: cannot remove a member'
);
select throws_ok(
  format($$ select public.delete_workspace(%L) $$, :'ws'),
  '42501', 'mfa_required',
  'aal1 owner: cannot delete the workspace'
);
select isnt_empty(
  format($$ select 1 from public.workspaces where id = %L and deleted_at is null $$, :'ws'),
  'the workspace is still there'
);

-- members leave without MFA ---------------------------------------------------------

select tests.authenticate_as(:'m', 'aal1');
select throws_ok(
  format($$ select public.delete_workspace(%L) $$, :'ws'),
  '42501', 'only an owner can delete a workspace',
  'a member cannot delete the workspace'
);
select tests.authenticate_as(:'m', 'aal2');
select throws_ok(
  format($$ select public.delete_workspace(%L) $$, :'ws'),
  '42501', 'only an owner can delete a workspace',
  'a member cannot delete it even with aal2'
);

-- aal2 owner -------------------------------------------------------------------------

select tests.authenticate_as(:'o', 'aal2');
select isnt_empty(
  format($$ delete from public.workspace_members where workspace_id = %L and user_id = %L returning user_id $$, :'ws', :'m'),
  'aal2 owner: removes a member'
);
select lives_ok(
  format($$ select public.delete_workspace(%L) $$, :'ws'),
  'aal2 owner: deletes the workspace'
);
select is_empty(
  format($$ select 1 from public.workspaces where id = %L $$, :'ws'),
  'a deleted workspace disappears for its members'
);
select throws_ok(
  format($$ select public.delete_workspace(%L) $$, tests.ws(:'o')),
  'P0001', 'last_workspace',
  'nobody can delete their last workspace'
);

-- leaving yourself needs no MFA --------------------------------------------------------

select tests.authenticate_as(:'o', 'aal1');
select public.create_workspace('Club') as club \gset
select tests.clear_authentication();
insert into public.workspace_members (workspace_id, user_id, role) values (:'club', :'m', 'member');
select tests.authenticate_as(:'m', 'aal1');
select isnt_empty(
  format($$ delete from public.workspace_members where workspace_id = %L and user_id = %L returning user_id $$, :'club', :'m'),
  'aal1 member: can leave'
);

select tests.authenticate_as_anon();
select throws_ok(
  format($$ select public.delete_workspace(%L) $$, :'club'),
  '42501', null,
  'anon: cannot delete'
);

select * from finish();
rollback;
