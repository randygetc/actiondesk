"use client";

import { useActionState, useState } from "react";

import type { InviteResult } from "@/app/(app)/workspace/actions";
import { fieldClass } from "@/components/tasks/types";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type FormAction = (
  prev: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;

/** True when the action asked for a second-factor code (step 3.5). */
const wantsCode = (state: ActionResult<unknown> | null) =>
  !!state && !state.ok && !!state.fieldErrors?.code;

function FormError({ state }: { state: ActionResult<unknown> | null }) {
  return state && !state.ok ? (
    <p role="alert" className="text-sm text-destructive">
      {state.error}
    </p>
  ) : null;
}

/** A one-field name form, for creating and renaming workspaces. */
export function NameForm({
  action,
  label,
  submit,
  defaultValue = "",
}: {
  action: FormAction;
  label: string;
  submit: string;
  defaultValue?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          name="name"
          aria-label={label}
          defaultValue={defaultValue}
          required
          maxLength={100}
          className={`${fieldClass} flex-1`}
        />
        <Button type="submit" disabled={pending}>
          {submit}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** Creates an invite and shows its link once, to copy and send (D-18). */
export function InviteForm({
  action,
}: {
  action: (
    prev: InviteResult | null,
    formData: FormData,
  ) => Promise<InviteResult>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  const link =
    state?.ok && typeof window !== "undefined"
      ? `${window.location.origin}${state.data.path}`
      : null;
  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-wrap gap-2">
        <input
          name="email"
          type="email"
          aria-label="Invite email"
          placeholder="name@example.com"
          required
          className={`${fieldClass} min-w-56 flex-1`}
        />
        <select
          name="role"
          aria-label="Invite role"
          defaultValue="member"
          className={fieldClass}
        >
          <option value="member">Member (can edit)</option>
          <option value="viewer">Viewer (read only)</option>
        </select>
        <Button type="submit" disabled={pending}>
          Create invite link
        </Button>
      </form>
      <FormError state={state} />
      {link && state?.ok ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md border p-3 text-sm"
        >
          <p>
            Send this link to {state.data.email}. It works once, for that email
            only, and expires in 7 days. It won&apos;t be shown again.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              aria-label="Invite link"
              value={link}
              className={`${fieldClass} flex-1 font-mono text-xs`}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Role select and remove button for one member (owners only). */
export function MemberControls({
  userId,
  role,
  isSelf,
  changeRole,
  removeMember,
}: {
  userId: string;
  role: "owner" | "member" | "viewer";
  isSelf: boolean;
  changeRole: FormAction;
  removeMember: FormAction;
}) {
  const [roleState, roleAction] = useActionState(changeRole, null);
  const [removeState, removeAction] = useActionState(removeMember, null);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <form action={roleAction}>
          <input type="hidden" name="userId" value={userId} />
          <select
            name="role"
            aria-label="Role"
            defaultValue={role}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={fieldClass}
          >
            <option value="owner">Owner</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
        </form>
        <form action={removeAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={userId} />
          {/* Asked for only when the session needs a second factor (step 3.5). */}
          {wantsCode(removeState) ? <CodeInput /> : null}
          <Button type="submit" variant="ghost" size="sm">
            {isSelf
              ? "Leave"
              : wantsCode(removeState)
                ? "Confirm remove"
                : "Remove"}
          </Button>
        </form>
      </div>
      <FormError state={roleState} />
      <FormError state={removeState} />
    </div>
  );
}

/** Leave button for non-owners. */
export function LeaveForm({
  userId,
  action,
}: {
  userId: string;
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" variant="ghost" size="sm">
        Leave
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** Accepts an invite (the token comes from the URL). */
export function AcceptInviteForm({
  token,
  action,
}: {
  token: string;
  action: FormAction;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Accept invite"}
      </Button>
      <FormError state={state} />
    </form>
  );
}

function CodeInput() {
  return (
    <input
      name="code"
      aria-label="Authentication code"
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123 456"
      required
      className={`${fieldClass} w-28`}
    />
  );
}

/** Owners only. A native <details> confirm, per the conventions. */
export function DeleteWorkspaceForm({
  name,
  needsCode,
  action,
}: {
  name: string;
  needsCode: boolean;
  action: FormAction;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <details className="rounded-md border border-destructive/40 p-3 text-sm">
      <summary className="cursor-pointer text-destructive">
        Delete workspace
      </summary>
      <form action={formAction} className="mt-3 flex flex-col gap-2">
        <p>
          This removes <strong>{name}</strong> and its projects and tasks for
          every member.
          {needsCode
            ? " Enter a code from your authenticator app to confirm."
            : ""}
        </p>
        <div className="flex items-center gap-2">
          {needsCode || wantsCode(state) ? <CodeInput /> : null}
          <Button type="submit" variant="destructive" disabled={pending}>
            Delete {name}
          </Button>
        </div>
        <FormError state={state} />
      </form>
    </details>
  );
}
