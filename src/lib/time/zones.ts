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

// Formatters are cached per zone: building an Intl.DateTimeFormat (or Temporal
// objects) per row cost ~40 ms on a 500-task page (step 3.7 profile).
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(key: string, make: () => Intl.DateTimeFormat) {
  let f = formatters.get(key);
  if (!f) {
    f = make();
    formatters.set(key, f);
  }
  return f;
}

/** UTC instant → local `YYYY-MM-DD` and `HH:MM` in the zone, e.g. for form defaults. */
export function toLocalParts(
  instant: Date,
  tz: string,
): { date: string; time: string } {
  const parts = formatter(
    `parts|${tz}`,
    () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
  ).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** Short display string in the zone, e.g. "Wed, Oct 7, 09:00"; date only for end-of-day. */
export function formatDue(instant: Date, tz: string): string {
  const withTime = toLocalParts(instant, tz).time !== END_OF_DAY;
  return formatter(
    `due|${tz}|${withTime}`,
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        ...(withTime
          ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
          : {}),
      }),
  ).format(instant);
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

/**
 * The next `days` local dates from `instant`'s day in the zone, with short
 * weekday names, e.g. for giving an LLM a calendar to resolve "next Friday".
 */
export function calendar(
  instant: Date,
  tz: string,
  days: number,
): { date: string; weekday: string }[] {
  const start = toZoned(instant, tz).toPlainDate();
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return Array.from({ length: days }, (_, i) => {
    const d = start.add({ days: i });
    return { date: d.toString(), weekday: names[d.dayOfWeek - 1] };
  });
}
