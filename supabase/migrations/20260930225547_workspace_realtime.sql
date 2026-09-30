-- Step 3.4: live updates for workspace members (docs/plan.md §4.6, R-12).
-- Realtime Broadcast on a private channel per workspace, `workspace:<id>`.
-- Messages say only what changed (table, operation, id), never the content:
-- the browser re-reads through RLS. Receiving is limited to members by RLS on
-- realtime.messages; clients can't send at all (no insert policy).

create function public.broadcast_workspace_change()
returns trigger
language plpgsql
security definer -- realtime.send inserts into realtime.messages, which clients can't
set search_path = ''
as $$
declare
  r record := coalesce(new, old);
begin
  perform realtime.send(
    jsonb_build_object('table', tg_table_name, 'op', lower(tg_op), 'id', r.id),
    tg_table_name || '_changed',
    'workspace:' || r.workspace_id::text,
    true -- private: subscribers are authorized by the policy below
  );
  return null;
end;
$$;

revoke execute on function public.broadcast_workspace_change() from public, anon, authenticated;

create trigger tasks_broadcast
  after insert or update or delete on public.tasks
  for each row execute function public.broadcast_workspace_change();

create trigger projects_broadcast
  after insert or update or delete on public.projects
  for each row execute function public.broadcast_workspace_change();

-- Members of a workspace (any role) receive its broadcasts; nobody else does.
create policy "realtime: members receive their workspace's broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'workspace:%'
    and split_part((select realtime.topic()), ':', 2)
        in (select w::text from public.my_workspaces('viewer') w)
  );
