/**
 * The only place UTC ↔ local conversion happens (plan §1). Pure functions:
 * every caller passes the instant and the IANA zone explicitly.
 */
import { Temporal } from "temporal-polyfill";

/** A due date entered without a time means "by the end of that day". */
export const END_OF_DAY = "23:59";

/**
 * Local wall-clock → UTC instant. Nonexistent times (spring-forward gap) use
 * Temporal's "compatible" rule and move forward by the gap: 02:30 → 03:30.
 * Ambiguous times (fall-back) resolve to the earlier of the two instants.
 */
export function toUtc(date: string, time: string | null, tz: string): Date {
  const local = Temporal.PlainDate.from(date).toPlainDateTime(
    Temporal.PlainTime.from(time ?? END_OF_DAY),
  );
  return new Date(
    local.toZonedDateTime(tz, { disambiguation: "compatible" })
      .epochMilliseconds,
  );
}

export function toZoned(instant: Date, tz: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(
    instant.getTime(),
  ).toZonedDateTimeISO(tz);
}

/** UTC instant → local `YYYY-MM-DD` and `HH:MM` in the zone, e.g. for form defaults. */
export function toLocalParts(
  instant: Date,
  tz: string,
): { date: string; time: string } {
  const z = toZoned(instant, tz);
  return {
    date: z.toPlainDate().toString(),
    time: z.toPlainTime().toString({ smallestUnit: "minute" }),
  };
}

/** Short display string in the zone, e.g. "Wed, Oct 7, 09:00"; date only for end-of-day. */
export function formatDue(instant: Date, tz: string): string {
  const { time } = toLocalParts(instant, tz);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(time === END_OF_DAY
      ? {}
      : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  }).format(instant);
}

/** True if `date` is a real calendar date in `YYYY-MM-DD` form. */
export function isValidDate(date: string): boolean {
  try {
    Temporal.PlainDate.from(date, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}
