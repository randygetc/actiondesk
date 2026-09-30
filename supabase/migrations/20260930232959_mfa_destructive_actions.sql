-- Step 3.5: destructive workspace actions need a second factor (TOTP), i.e. an
-- aal2 session. Enforced here, not only in the UI (docs/plan.md §4.3, §4.6).

-- Removing someone else requires aal2; leaving yourself does not.
drop policy "workspace_members: delete as owner or self" on public.workspace_members;

create policy "workspace_members: delete self, or as owner with aal2"
  on public.workspace_members for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      workspace_id in (select public.my_workspaces('owner'))
      and (select auth.jwt() ->> 'aal') = 'aal2'
    )
  );

-- Soft-deletes a workspace (D-17): it disappears for every member at once,
-- since my_workspaces() skips deleted workspaces. Owner + aal2 only, and never
-- the caller's last workspace (the app always needs one to show).
create function public.delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member(p_workspace_id, 'owner') then
    raise exception 'only an owner can delete a workspace' using errcode = '42501';
  end if;
  if coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.my_workspaces('viewer') w where w <> p_workspace_id
  ) then
    raise exception 'last_workspace' using errcode = 'P0001';
  end if;

  update public.workspaces set deleted_at = now() where id = p_workspace_id;
end;
$$;

revoke execute on function public.delete_workspace(uuid) from public, anon;
grant execute on function public.delete_workspace(uuid) to authenticated;
