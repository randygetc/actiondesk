-- /api/health's database probe (step 3.10): callable by anon, reads nothing.
begin;
\ir helpers/auth.psql
select plan(3);

select tests.authenticate_as_anon();
select is(public.health_check(), true, 'anon can call health_check');

select tests.clear_authentication();
select is(
  (select prosecdef from pg_proc where oid = 'public.health_check()'::regprocedure),
  false,
  'health_check is security invoker (no elevated rights)'
);
select is(
  (select provolatile from pg_proc where oid = 'public.health_check()'::regprocedure),
  's',
  'health_check is stable (callable with GET)'
);

select * from finish();
rollback;
