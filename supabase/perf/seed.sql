-- Step 3.7: large local data set (KICKOFF). LOCAL ONLY, never run in CI or prod.
--   docker exec -i supabase_db_actiondesk psql -U postgres < supabase/perf/seed.sql
-- 5 users (perf1..perf5@example.com, password "perf-password") with
-- overlapping memberships, 20 workspaces, 500 projects, 100,000 tasks.
-- Re-runnable: deletes its previous users (and so their data) first.

\set ON_ERROR_STOP on
begin;

-- Workspaces outlive their creator (created_by is set null), so remove them too.
delete from public.workspaces where name like 'Perf workspace %';
delete from auth.users where email like 'perf_@example.com';

-- Users who can sign in with a password (auth.users + auth.identities).
-- Auth reads the token columns as strings: they must be '' rather than NULL,
-- like rows it creates itself, or sign-in fails ("Database error querying schema").
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
       extensions.crypt('perf-password', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', 'Perf ' || n),
       now(), now(), '', '', '', '', '', '', '', ''
  from (select n, ('00000000-0000-4000-a000-00000000000' || n)::uuid as id, 'perf' || n || '@example.com' as email
          from generate_series(1, 5) n) u;
insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
select gen_random_uuid(), id, id::text, 'email',
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
  from auth.users where email like 'perf_@example.com';
update public.profiles set timezone = 'Asia/Manila' where id in (select id from auth.users where email like 'perf_@example.com');

-- 20 workspaces; in workspace w, user (w % 5) is owner, (w+1) % 5 member, (w+2) % 5 viewer.
create temporary table perf_users on commit drop as
select row_number() over (order by email) - 1 as i, id from auth.users where email like 'perf_@example.com';
create temporary table perf_ws on commit drop as
select w, gen_random_uuid() as id from generate_series(0, 19) w;

insert into public.workspaces (id, name, created_by)
select ws.id, 'Perf workspace ' || ws.w, u.id from perf_ws ws join perf_users u on u.i = ws.w % 5;
insert into public.workspace_members (workspace_id, user_id, role)
select ws.id, u.id, r.role::public.workspace_role
  from perf_ws ws
  cross join (values (0, 'owner'), (1, 'member'), (2, 'viewer')) r(k, role)
  join perf_users u on u.i = (ws.w + r.k) % 5;

-- Bulk inserts: pause the per-row broadcast and derived-column triggers, and
-- set what tasks_before_write would have set (completed_at, series_id).
alter table public.projects disable trigger projects_broadcast;
alter table public.tasks disable trigger tasks_broadcast;
alter table public.tasks disable trigger tasks_before_write;

-- 25 projects per workspace.
insert into public.projects (workspace_id, owner_id, name, archived_at)
select ws.id, u.id, 'Project ' || p, case when p > 22 then now() - interval '30 days' end
  from perf_ws ws join perf_users u on u.i = ws.w % 5
  cross join generate_series(1, 25) p;

-- 5,000 tasks per workspace: 40% done, 10% doing, 50% todo; due dates spread
-- over -60..+60 days (30% none); 70% in a project; 5% weekly recurring.
insert into public.tasks (id, workspace_id, owner_id, title, status, priority, due_at,
                          project_id, completed_at, recurrence, recurrence_tz, series_id)
select id, workspace_id, owner_id, title, status, priority, due_at, project_id,
       case when status = 'done' then coalesce(due_at, now()) - interval '1 hour' end,
       case when recurring then 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' end,
       case when recurring then 'Asia/Manila' end,
       case when recurring then id end
  from (
    select gen_random_uuid() as id, ws.id as workspace_id, u.id as owner_id,
           (array['Review', 'Send', 'Prepare', 'Follow up on', 'Update', 'Fix', 'Draft', 'Schedule'])[1 + (t % 8)]
             || ' ' || (array['invoice', 'deck', 'report', 'contract', 'release notes', 'budget', 'hiring plan', 'roadmap'])[1 + ((t / 8) % 8)]
             || ' ' || t as title,
           (case when t % 10 < 4 then 'done' when t % 10 = 4 then 'doing' else 'todo' end)::public.task_status as status,
           (array['low', 'normal', 'normal', 'high', 'urgent'])[1 + (t % 5)]::public.task_priority as priority,
           case when t % 10 < 3 then null
                else now() + ((t * 7919) % 120 - 60) * interval '1 day' + (t % 24) * interval '1 hour' end as due_at,
           case when t % 10 < 7 then (select p.id from public.projects p
                                       where p.workspace_id = ws.id order by p.name
                                       offset (t % 25) limit 1) end as project_id,
           (t % 20 = 0 and t % 10 >= 3) as recurring
      from perf_ws ws
      join perf_users u on u.i = ws.w % 5
      cross join generate_series(1, 5000) t
  ) s;

alter table public.tasks enable trigger tasks_before_write;
alter table public.tasks enable trigger tasks_broadcast;
alter table public.projects enable trigger projects_broadcast;

commit;
analyze public.tasks;
analyze public.projects;
analyze public.workspace_members;

select 'perf users', count(*) from auth.users where email like 'perf_@example.com'
union all select 'workspaces', count(*) from public.workspaces where name like 'Perf workspace %'
union all select 'projects', count(*) from public.projects p join public.workspaces w on w.id = p.workspace_id where w.name like 'Perf workspace %'
union all select 'tasks', count(*) from public.tasks t join public.workspaces w on w.id = t.workspace_id where w.name like 'Perf workspace %';
