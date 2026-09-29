-- ActionDesk: every public table must have RLS enabled (ADR-0001, rule R1). LOCKED.
begin;
select plan(2);

select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity $$,
  'every table in the public schema has row level security enabled'
);

select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('v', 'm')
        and not coalesce(
          (select bool_or(opt like 'security_invoker=%true' or opt = 'security_invoker=on')
             from unnest(c.reloptions) as opt), false) $$,
  'every public view runs with security_invoker so RLS applies'
);

select * from finish();
rollback;
