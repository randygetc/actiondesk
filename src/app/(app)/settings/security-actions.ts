"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { MFA_MESSAGES, mfaStatus, stepUp, verifyCode } from "@/lib/auth/mfa";
import { requestLog } from "@/lib/request-log";
import { createClient } from "@/lib/supabase/server";
import { totpCodeSchema } from "@/lib/validation/workspace";

// Settings → Security: TOTP enroll, verify, turn off (step 3.5). Codes and
// secrets are never logged.

async function getUserClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export type Enrollment = ActionResult<{
  factorId: string;
  qrCode: string;
  secret: string;
}>;

/** Starts TOTP setup: returns the QR code and secret to add to an authenticator app. */
export async function startTotp(): Promise<Enrollment> {
  const { supabase, user } = await getUserClient();
  if (!user) return { ok: false, error: "You are signed out." };

  // An abandoned, unverified setup would block a new one; clear it first.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? [])
    if (f.factor_type === "totp" && f.status === "unverified")
      await supabase.auth.mfa.unenroll({ factorId: f.id });

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
  });
  if (error || !data) {
    (await requestLog()).error("mfa.enroll_failed", {
      userId: user.id,
      code: error?.code ?? null,
    });
    return { ok: false, error: "Couldn't start setup. Try again." };
  }
  return {
    ok: true,
    data: {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    },
  };
}

/** Finishes setup with the first code from the app; the session becomes aal2. */
export async function confirmTotp(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const factorId = z.uuid().safeParse(formData.get("factorId"));
  const code = totpCodeSchema.safeParse(formData.get("code") ?? "");
  if (!factorId.success || !code.success || code.data === "")
    return {
      ok: false,
      error: "Enter the 6-digit code",
      fieldErrors: { code: ["Enter the 6-digit code"] },
    };
  const { supabase, user } = await getUserClient();
  if (!user) return { ok: false, error: "You are signed out." };

  if (!(await verifyCode(supabase, factorId.data, code.data)))
    return {
      ok: false,
      error: MFA_MESSAGES.badCode,
      fieldErrors: { code: [MFA_MESSAGES.badCode] },
    };
  (await requestLog()).info("mfa.enrolled", { userId: user.id });
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

/** Turns TOTP off. Needs a current code (Supabase requires aal2 to remove a verified factor). */
export async function turnOffTotp(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const code = totpCodeSchema.safeParse(formData.get("code") ?? "");
  if (!code.success) return { ok: false, error: MFA_MESSAGES.badCode };
  const { supabase, user } = await getUserClient();
  if (!user) return { ok: false, error: "You are signed out." };

  const step = await stepUp(supabase, code.data || null);
  if (!step.ok) return { ok: false, error: step.error };
  const { factorId } = await mfaStatus(supabase);
  if (!factorId) return { ok: true, data: undefined };

  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    (await requestLog()).error("mfa.unenroll_failed", {
      userId: user.id,
      code: error.code ?? null,
    });
    return { ok: false, error: "Couldn't turn it off. Try again." };
  }
  (await requestLog()).info("mfa.unenrolled", { userId: user.id });
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
