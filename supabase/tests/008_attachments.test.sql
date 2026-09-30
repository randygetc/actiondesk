-- attachments rows and their storage objects (step 2.7): own-folder only.
begin;
\ir helpers/auth.psql
select plan(20);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset
select gen_random_uuid() as ida \gset
select gen_random_uuid() as idb \gset

-- rows ----------------------------------------------------------------------

select tests.authenticate_as(:'a');

select lives_ok(
  format($$ insert into public.attachments (id, storage_path, mime_type, size_bytes)
            values (%L, %L, 'application/pdf', 1000) $$, :'ida', :'a' || '/' || :'ida' || '.pdf'),
  'owner: can record an attachment in their own folder'
);
select throws_ok(
  format($$ insert into public.attachments (id, storage_path, mime_type, size_bytes)
            values (%L, %L, 'application/pdf', 1000) $$, :'idb', :'b' || '/' || :'idb' || '.pdf'),
  '23514', null,
  'cannot point a row at another user''s folder'
);
select throws_ok(
  format($$ insert into public.attachments (id, storage_path, mime_type, size_bytes)
            values (%L, %L, 'application/x-msdownload', 1000) $$, :'idb', :'a' || '/' || :'idb' || '.pdf'),
  '23514', null,
  'an unsupported mime type is rejected'
);
select throws_ok(
  format($$ insert into public.attachments (id, storage_path, mime_type, size_bytes)
            values (%L, %L, 'application/pdf', 10485761) $$, :'idb', :'a' || '/' || :'idb' || '.pdf'),
  '23514', null,
  'more than 10 MB is rejected'
);
select throws_ok(
  format($$ insert into public.attachments (id, storage_path, mime_type, size_bytes)
            values (%L, %L, 'application/pdf', 1000) $$, :'idb', :'a' || '/' || :'idb' || '.exe'),
  '23514', null,
  'an unexpected extension is rejected'
);
select throws_ok(
  format($$ insert into public.attachments (owner_id, id, storage_path, mime_type, size_bytes)
            values (%L, %L, %L, 'application/pdf', 1000) $$, :'b', :'idb', :'b' || '/' || :'idb' || '.pdf'),
  '42501', null,
  'cannot set owner_id'
);
select throws_ok(
  $$ update public.attachments set size_bytes = 1 $$,
  '42501', null,
  'owner: cannot update an attachment'
);

-- objects -------------------------------------------------------------------

select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('attachments', %L) $$,
         :'a' || '/' || :'ida' || '.pdf'),
  'owner: can upload into their own folder'
);
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('attachments', %L) $$,
         :'b' || '/sneaky.pdf'),
  '42501', null,
  'owner: cannot upload into another user''s folder'
);
select results_eq(
  $$ select count(*)::int from storage.objects where bucket_id = 'attachments' $$,
  $$ values (1) $$,
  'owner: sees their own object'
);

-- other user ------------------------------------------------------------------

-- Direct deletes are blocked unless this is set; the Storage API sets it and
-- RLS still applies, so the tests below behave like Storage API deletes.
set local storage.allow_delete_query = 'true';

select tests.authenticate_as(:'b');

select is_empty($$ select 1 from public.attachments $$, 'other user: cannot see the owner''s row');
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'attachments' $$,
  'other user: cannot see the owner''s object'
);
select is_empty(
  $$ delete from public.attachments returning id $$,
  'other user: cannot delete the owner''s row'
);
select is_empty(
  $$ delete from storage.objects where bucket_id = 'attachments' returning name $$,
  'other user: cannot delete the owner''s object'
);

-- owner deletes (after review) -----------------------------------------------

select tests.authenticate_as(:'a');

select isnt_empty(
  $$ delete from storage.objects where bucket_id = 'attachments' returning name $$,
  'owner: can delete their object'
);
select isnt_empty(
  $$ delete from public.attachments returning id $$,
  'owner: can delete their row'
);

-- anon ------------------------------------------------------------------------

select tests.authenticate_as_anon();

select throws_ok(
  $$ select 1 from public.attachments $$,
  '42501', null,
  'anon: cannot read attachments'
);
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'attachments' $$,
  'anon: sees no objects'
);

select tests.clear_authentication();
select is(
  (select public from storage.buckets where id = 'attachments'),
  false,
  'the attachments bucket is private'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.attachments'::regclass),
  true,
  'RLS is enabled on attachments'
);

select * from finish();
rollback;
