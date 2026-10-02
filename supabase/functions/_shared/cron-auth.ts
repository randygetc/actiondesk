// Authenticates scheduled calls from pg_cron (invoke_* functions in SQL).
//
// Not the service key: hosted Supabase injects a SUPABASE_SERVICE_ROLE_KEY
// into Edge Functions that matches none of the project's listed keys, so no
// caller can present it (found in prod, 2026-10-02). A dedicated random
// CRON_SECRET lives in two places instead: a function secret and the Vault
// secret `cron_secret`.

/** At least 32 characters; anything shorter is treated as not configured. */
export const MIN_SECRET_LENGTH = 32;

/** True only for `Bearer <secret>` with a configured secret. Constant time. */
export function isCronCall(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH || !authorization)
    return false;
  const enc = new TextEncoder();
  const given = enc.encode(authorization);
  const expected = enc.encode(`Bearer ${secret}`);
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++)
    diff |= (given[i] ?? 0) ^ expected[i];
  return diff === 0;
}
