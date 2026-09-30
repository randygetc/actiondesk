import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

// TOTP second factor (step 3.5). Server-side only: enrolling and verifying
// change the session, so they run in Server Actions (ADR-0004) and the
// upgraded aal2 session is written back to the cookies.

type Client = SupabaseClient<Database>;

export type MfaStatus = {
  /** aal2 = this session was verified with the second factor. */
  level: "aal1" | "aal2";
  /** The verified TOTP factor, if the user has set one up. */
  factorId: string | null;
};

export async function mfaStatus(supabase: Client): Promise<MfaStatus> {
  const [{ data: aal }, { data: factors }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  return {
    level: aal?.currentLevel === "aal2" ? "aal2" : "aal1",
    factorId: factors?.totp.find((f) => f.status === "verified")?.id ?? null,
  };
}

/** Verifies a 6-digit code; on success the session becomes aal2. */
export async function verifyCode(
  supabase: Client,
  factorId: string,
  code: string,
): Promise<boolean> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code,
  });
  return !error;
}

export const MFA_MESSAGES = {
  needCode: "Enter the 6-digit code from your authenticator app to confirm.",
  badCode: "That code didn't work. Try the current one.",
  noFactor:
    "This needs two-factor authentication. Set up an authenticator app in Settings → Security first.",
} as const;

export type StepUp =
  { ok: true } | { ok: false; error: string; needsCode: boolean };

/**
 * Makes sure this session is aal2 before a destructive action, using the
 * optional code from the form. The database enforces aal2 anyway (RLS and
 * delete_workspace); this gives the user a clear prompt instead of a refusal.
 */
export async function stepUp(
  supabase: Client,
  code: string | null,
): Promise<StepUp> {
  const status = await mfaStatus(supabase);
  if (status.level === "aal2") return { ok: true };
  if (!status.factorId)
    return { ok: false, error: MFA_MESSAGES.noFactor, needsCode: false };
  if (!code)
    return { ok: false, error: MFA_MESSAGES.needCode, needsCode: true };
  return (await verifyCode(supabase, status.factorId, code))
    ? { ok: true }
    : { ok: false, error: MFA_MESSAGES.badCode, needsCode: true };
}
