-- tasks provenance (step 2.3): source, source_quote, assignee_text.
begin;
\ir helpers/auth.psql
select plan(9);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

select tests.authenticate_as(:'a');

select results_eq(
  $$ insert into public.tasks (title) values ('Manual') returning source::text, source_quote, assignee_text $$,
  $$ values ('manual'::text, null::text, null::text) $$,
  'defaults: source manual, no quote, no assignee'
);
select lives_ok(
  $$ insert into public.tasks (title, source, source_quote, assignee_text)
       values ('Extracted', 'extraction', 'Randy to send the copy by Friday', 'me') $$,
  'owner: can create an extracted task with its quote and assignee'
);
select throws_ok(
  format($$ insert into public.tasks (title, source_quote) values ('Long', %L) $$, repeat('x', 501)),
  '23514', null,
  'source_quote is at most 500 characters'
);
select throws_ok(
  format($$ insert into public.tasks (title, assignee_text) values ('Long', %L) $$, repeat('x', 201)),
  '23514', null,
  'assignee_text is at most 200 characters'
);

-- Provenance is fixed at creation; the assignee stays editable.
select throws_ok(
  $$ update public.tasks set source = 'manual' where title = 'Extracted' $$,
  '42501', null,
  'owner: cannot change source'
);
select throws_ok(
  $$ update public.tasks set source_quote = 'edited' where title = 'Extracted' $$,
  '42501', null,
  'owner: cannot change source_quote'
);
select results_eq(
  $$ update public.tasks set assignee_text = 'Ana' where title = 'Extracted' returning assignee_text $$,
  $$ values ('Ana'::text) $$,
  'owner: can change assignee_text'
);

-- Other user and anon: the existing own-row policies still apply to the new columns.
select tests.authenticate_as(:'b');
select is_empty(
  $$ update public.tasks set assignee_text = 'B' where title = 'Extracted' returning id $$,
  'other user: cannot change the owner''s assignee_text'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into public.tasks (title, source) values ('x', 'extraction') $$,
  '42501', null,
  'anon: cannot create tasks'
);

select * from finish();
rollback;
