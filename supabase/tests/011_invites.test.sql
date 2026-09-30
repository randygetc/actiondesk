-- Invites (step 3.3, D-16): owner-only creation, hashed single-use tokens,
-- email must match, expiry, and what each role can see.
begin;
\ir helpers/auth.psql
select plan(24);

select tests.create_user('owner@example.com') as o \gset
select tests.create_user('Invitee@Example.com') as i \gset
select tests.create_user('other@example.com') as x \gset

select tests.authenticate_as(:'o');
select public.create_workspace('Team') as ws \gset

-- creating --------------------------------------------------------------------

select public.create_invite(:'ws', '  INVITEE@example.com ', 'viewer') as tok \gset
select is(length(:'tok'), 64, 'owner: gets a 64-hex-character token');
select results_eq(
  $$ select email, role::text, accepted_at from public.invites $$,
  $$ values ('invitee@example.com'::text, 'viewer'::text, null::timestamptz) $$,
  'the email is normalized; the invite is open'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.invites where token_hash = sha256(convert_to(:'tok', 'UTF8'))),
  1,
  'only the token''s hash is stored'
);
select tests.authenticate_as(:'o');
select throws_ok(
  $$ select token_hash from public.invites $$,
  '42501', null,
  'owner: cannot read token hashes'
);
select throws_ok(
  format($$ select public.create_invite(%L, 'someone@example.com', 'owner') $$, :'ws'),
  '23514', null,
  'nobody is invited as owner'
);
select throws_ok(
  format($$ select public.create_invite(%L, 'owner@example.com', 'member') $$, :'ws'),
  'P0001', 'invite_already_member',
  'an existing member is not invited'
);
select public.create_invite(:'ws', 'invitee@example.com', 'member') as tok2 \gset
select results_eq(
  $$ select role::text from public.invites where accepted_at is null $$,
  $$ values ('member'::text) $$,
  'a new invite replaces the open one for the same email'
);

-- others can't create or see invites --------------------------------------------

select tests.authenticate_as(:'x');
select throws_ok(
  format($$ select public.create_invite(%L, 'x2@example.com', 'member') $$, :'ws'),
  '42501', null,
  'non-member: cannot invite'
);
select is_empty($$ select 1 from public.invites $$, 'non-member: sees no invites');

-- preview -----------------------------------------------------------------------

select results_eq(
  format($$ select status from public.invite_preview(%L) $$, :'tok2'),
  $$ values ('wrong_email'::text) $$,
  'someone else''s invite: preview says so and reveals nothing else'
);
select results_eq(
  $$ select status from public.invite_preview('not-a-token') $$,
  $$ values ('invalid'::text) $$,
  'an unknown token is invalid'
);

select tests.authenticate_as(:'i');
select results_eq(
  format($$ select status, workspace_name, role::text from public.invite_preview(%L) $$, :'tok2'),
  $$ values ('ok'::text, 'Team'::text, 'member'::text) $$,
  'invitee: preview shows the workspace and role'
);
select results_eq(
  format($$ select status from public.invite_preview(%L) $$, :'tok'),
  $$ values ('invalid'::text) $$,
  'the replaced token no longer works'
);

-- accepting ---------------------------------------------------------------------

select tests.authenticate_as(:'x');
select throws_ok(
  format($$ select public.accept_invite(%L) $$, :'tok2'),
  'P0001', 'invite_wrong_email',
  'a different signed-in user cannot accept'
);

select tests.authenticate_as(:'i');
select is(public.accept_invite(:'tok2'), :'ws'::uuid, 'invitee: accepts and gets the workspace id');
select results_eq(
  format($$ select role::text from public.workspace_members where workspace_id = %L and user_id = %L $$, :'ws', :'i'),
  $$ values ('member'::text) $$,
  'invitee: is now a member with the invited role'
);
select isnt_empty(
  format($$ select 1 from public.workspaces where id = %L $$, :'ws'),
  'invitee: can see the workspace'
);
select throws_ok(
  format($$ select public.accept_invite(%L) $$, :'tok2'),
  'P0001', 'invite_used',
  'an invite can be used once'
);
select results_eq(
  format($$ select status from public.invite_preview(%L) $$, :'tok2'),
  $$ values ('used'::text) $$,
  'preview of a used invite says so'
);
select is_empty($$ select 1 from public.invites $$, 'a member (not owner) sees no invites');

-- expiry --------------------------------------------------------------------------

select tests.authenticate_as(:'o');
select public.create_invite(:'ws', 'other@example.com', 'viewer') as tok3 \gset
select tests.clear_authentication();
update public.invites set expires_at = now() - interval '1 second' where email = 'other@example.com';
select tests.authenticate_as(:'x');
select throws_ok(
  format($$ select public.accept_invite(%L) $$, :'tok3'),
  'P0001', 'invite_expired',
  'an expired invite is rejected'
);

-- revoking ------------------------------------------------------------------------

select tests.authenticate_as(:'o');
select isnt_empty(
  $$ delete from public.invites where email = 'other@example.com' returning id $$,
  'owner: revokes an invite'
);

-- anon ------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select public.accept_invite('x') $$, '42501', null, 'anon: cannot accept');
select throws_ok($$ select 1 from public.invites $$, '42501', null, 'anon: cannot read invites');

select * from finish();
rollback;
