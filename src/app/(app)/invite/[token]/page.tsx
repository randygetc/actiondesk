import Link from "next/link";

import { AcceptInviteForm } from "@/components/workspace/forms";
import { requireUser } from "@/lib/auth/user";
import { INVITE_ERRORS, inviteTokenSchema } from "@/lib/validation/workspace";

import { acceptInvite } from "../../workspace/actions";

const STATUS_ERRORS: Record<string, string> = {
  invalid: INVITE_ERRORS.invite_invalid,
  used: INVITE_ERRORS.invite_used,
  expired: INVITE_ERRORS.invite_expired,
  wrong_email: INVITE_ERRORS.invite_wrong_email,
};

/**
 * Invite link (step 3.3). Signed-out visitors go through login and come back
 * (proxy + safeNextPath). The preview only names the workspace to the invited
 * email; the token is never logged.
 */
export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { supabase, user } = await requireUser();
  const token = inviteTokenSchema.safeParse((await params).token);

  const preview = token.success
    ? (await supabase.rpc("invite_preview", { p_token: token.data })).data?.[0]
    : undefined;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">Workspace invite</h1>
      {preview?.status === "ok" && token.success ? (
        <>
          <p>
            You&apos;ve been invited to{" "}
            <strong>{preview.workspace_name}</strong> as{" "}
            {preview.role === "viewer" ? "a viewer (read only)" : "a member"}.
          </p>
          <p className="text-sm text-muted-foreground">
            Signed in as {user.email}.
          </p>
          <AcceptInviteForm token={token.data} action={acceptInvite} />
        </>
      ) : (
        <>
          <p role="alert">{STATUS_ERRORS[preview?.status ?? "invalid"]}</p>
          <Link href="/tasks" className="text-sm underline">
            Go to your tasks
          </Link>
        </>
      )}
    </div>
  );
}
