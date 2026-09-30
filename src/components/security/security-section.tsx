"use client";

import { useActionState, useState } from "react";

import type { Enrollment } from "@/app/(app)/settings/security-actions";
import { fieldClass } from "@/components/tasks/types";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type FormAction = (
  prev: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;

function CodeInput({ label = "Authentication code" }: { label?: string }) {
  return (
    <input
      name="code"
      aria-label={label}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]{6,7}"
      placeholder="123 456"
      required
      className={`${fieldClass} w-32`}
    />
  );
}

/** Settings → Security (step 3.5): set up, or turn off, an authenticator app. */
export function SecuritySection({
  enabled,
  start,
  confirm,
  turnOff,
}: {
  enabled: boolean;
  start: () => Promise<Enrollment>;
  confirm: FormAction;
  turnOff: FormAction;
}) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmState, confirmAction, confirming] = useActionState(
    confirm,
    null,
  );
  const [offState, offAction, turningOff] = useActionState(turnOff, null);

  if (enabled) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          Two-factor authentication is <strong>on</strong>. You&apos;ll be asked
          for a code before deleting a workspace or removing a member.
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer">Turn off</summary>
          <form action={offAction} className="mt-2 flex items-center gap-2">
            <CodeInput />
            <Button type="submit" variant="outline" disabled={turningOff}>
              Turn off two-factor
            </Button>
          </form>
          {offState && !offState.ok ? (
            <p role="alert" className="text-destructive">
              {offState.error}
            </p>
          ) : null}
        </details>
      </div>
    );
  }

  if (confirmState?.ok) {
    return (
      <p role="status" className="text-sm">
        Two-factor authentication is on.
      </p>
    );
  }

  if (enrollment?.ok) {
    const { factorId, qrCode, secret } = enrollment.data;
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Scan this with Google Authenticator (or any TOTP app), then enter the
          code it shows.
        </p>
        {/* Supabase returns the QR code as an SVG data URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrCode}
          alt="QR code for your authenticator app"
          className="size-44 bg-white p-2"
        />
        <p>
          Can&apos;t scan? Enter this key:{" "}
          <code
            aria-label="Setup key"
            className="break-all rounded bg-muted px-1"
          >
            {secret}
          </code>
        </p>
        <form action={confirmAction} className="flex items-center gap-2">
          <input type="hidden" name="factorId" value={factorId} />
          <CodeInput />
          <Button type="submit" disabled={confirming}>
            Verify and turn on
          </Button>
        </form>
        {confirmState && !confirmState.ok ? (
          <p role="alert" className="text-destructive">
            {confirmState.error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        Two-factor authentication is <strong>off</strong>. Owners need it to
        delete a workspace or remove a member.
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={starting}
          onClick={async () => {
            setStarting(true);
            setEnrollment(await start());
            setStarting(false);
          }}
        >
          Set up authenticator app
        </Button>
      </div>
      {enrollment && !enrollment.ok ? (
        <p role="alert" className="text-destructive">
          {enrollment.error}
        </p>
      ) : null}
    </div>
  );
}
