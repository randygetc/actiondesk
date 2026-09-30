import { z } from "zod";

// Workspace management forms (step 3.3).

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(100, "At most 100 characters");

export const inviteSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter an email address")),
  role: z.enum(["member", "viewer"]),
});

export const memberRoleSchema = z.strictObject({
  userId: z.uuid(),
  role: z.enum(["owner", "member", "viewer"]),
});

/** Invite tokens are 64 hex characters (create_invite). */
export const inviteTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Maps accept_invite / create_invite error keys to messages. */
export const INVITE_ERRORS: Record<string, string> = {
  invite_invalid: "This invite link isn't valid.",
  invite_used: "This invite has already been used.",
  invite_expired: "This invite has expired. Ask the owner for a new one.",
  invite_wrong_email:
    "This invite is for a different email address. Sign in with the invited account.",
  invite_already_member: "That person is already a member.",
};

/** A TOTP code: 6 digits (spaces allowed while typing). Blank means "not given". */
export const totpCodeSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/\s/g, "") : v),
  z.union([
    z.literal(""),
    z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  ]),
);
