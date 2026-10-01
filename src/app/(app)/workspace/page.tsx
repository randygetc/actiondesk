import {
  DeleteWorkspaceForm,
  InviteForm,
  LeaveForm,
  MemberControls,
  NameForm,
  TestDigestForm,
} from "@/components/workspace/forms";
import { Button } from "@/components/ui/button";
import { mfaStatus } from "@/lib/auth/mfa";
import { requireUser } from "@/lib/auth/user";
import { currentWorkspace } from "@/lib/workspace/current";

import {
  changeRole,
  createInvite,
  createWorkspace,
  deleteWorkspace,
  removeMember,
  renameWorkspace,
  revokeInvite,
  sendTestDigest,
} from "./actions";

const ROLE_LABELS = {
  owner: "Owner",
  member: "Member",
  viewer: "Viewer",
} as const;

/** The current workspace: members, invites (owners), new workspace (step 3.3). */
export default async function WorkspacePage() {
  const { supabase, user } = await requireUser();
  const { current } = await currentWorkspace(supabase, user.id);
  const isOwner = current.role === "owner";
  const mfa = isOwner ? await mfaStatus(supabase) : null;

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, role, profile:profiles(display_name)")
      .eq("workspace_id", current.id)
      .order("created_at"),
    // RLS returns rows only to owners.
    supabase
      .from("invites")
      .select("id, email, role, expires_at")
      .eq("workspace_id", current.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">{current.name}</h1>
        <p className="text-sm text-muted-foreground">
          You are {ROLE_LABELS[current.role].toLowerCase()} of this workspace.
        </p>
      </div>

      {isOwner ? (
        <section className="flex flex-col gap-2" aria-labelledby="rename">
          <h2 id="rename" className="font-medium">
            Name
          </h2>
          <NameForm
            action={renameWorkspace}
            label="Workspace name"
            submit="Rename"
            defaultValue={current.name}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="members">
        <h2 id="members" className="font-medium">
          Members
        </h2>
        <ul className="divide-y rounded-md border" aria-label="Members">
          {(members ?? []).map((m) => (
            <li
              key={m.user_id}
              className="flex items-center justify-between gap-3 px-4 py-2"
            >
              <span>
                {m.profile?.display_name ?? "Unnamed"}
                {m.user_id === user.id ? " (you)" : ""}
                {isOwner ? null : (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {ROLE_LABELS[m.role]}
                  </span>
                )}
              </span>
              {isOwner ? (
                <MemberControls
                  userId={m.user_id}
                  role={m.role}
                  isSelf={m.user_id === user.id}
                  changeRole={changeRole}
                  removeMember={removeMember}
                />
              ) : m.user_id === user.id ? (
                <LeaveForm userId={user.id} action={removeMember} />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {isOwner ? (
        <section className="flex flex-col gap-2" aria-labelledby="invites">
          <h2 id="invites" className="font-medium">
            Invite someone
          </h2>
          <InviteForm action={createInvite} />
          {invites && invites.length > 0 ? (
            <ul
              className="divide-y rounded-md border text-sm"
              aria-label="Open invites"
            >
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between px-4 py-2"
                >
                  <span>
                    {inv.email} · {ROLE_LABELS[inv.role]}
                  </span>
                  <form action={revokeInvite}>
                    <input type="hidden" name="id" value={inv.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Revoke
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {isOwner ? (
        <section className="flex flex-col gap-2" aria-labelledby="digest">
          <h2 id="digest" className="font-medium">
            Weekly digest
          </h2>
          <p className="text-sm text-muted-foreground">
            Every member gets an AI summary of the week on Monday at 8am in
            their own time zone: what got done, what&apos;s overdue, what&apos;s
            coming up.
          </p>
          <TestDigestForm action={sendTestDigest} />
        </section>
      ) : null}

      {isOwner && mfa ? (
        <section className="flex flex-col gap-2" aria-labelledby="danger">
          <h2 id="danger" className="font-medium">
            Danger zone
          </h2>
          <DeleteWorkspaceForm
            name={current.name}
            needsCode={mfa.level !== "aal2" && mfa.factorId !== null}
            action={deleteWorkspace}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="new-workspace">
        <h2 id="new-workspace" className="font-medium">
          New workspace
        </h2>
        <NameForm
          action={createWorkspace}
          label="New workspace name"
          submit="Create"
        />
      </section>
    </div>
  );
}
