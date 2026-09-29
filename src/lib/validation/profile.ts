import { z } from "zod";

/** IANA zones the runtime knows, plus "UTC" (which Intl lists only as an alias). */
export const TIME_ZONES: readonly string[] = [
  "UTC",
  ...Intl.supportedValuesOf("timeZone"),
];

const zoneSet = new Set(TIME_ZONES);

export const timeZoneSchema = z
  .string()
  .refine((tz) => zoneSet.has(tz), { message: "Unknown time zone" });

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(100, "At most 100 characters")
    .transform((s) => (s === "" ? null : s)),
  timezone: timeZoneSchema,
});

export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
