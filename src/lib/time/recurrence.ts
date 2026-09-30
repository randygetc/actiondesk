/**
 * Preset recurrence (D-6), stored as RRULE bodies without DTSTART. Expansion is
 * done here in local wall-clock time, then converted to UTC (R-8). The DB
 * check constraint on tasks.recurrence mirrors parseRRule.
 */
import { Temporal } from "temporal-polyfill";

import { toZoned } from "./zones";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type Preset =
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "weekly"; day: Weekday }
  | { kind: "everyNWeeks"; n: number; day: Weekday }
  | { kind: "monthlyDay"; day: number } // 1–28, or -1 for the last day
  | { kind: "monthlyNth"; nth: number; day: Weekday }; // 1–4, or -1 for the last

const DAY_NAMES: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

const isoDow = (d: Weekday) => WEEKDAYS.indexOf(d) + 1;

export const isMonthDay = (d: number) =>
  d === -1 || (Number.isInteger(d) && d >= 1 && d <= 28);
export const isNth = (n: number) =>
  n === -1 || (Number.isInteger(n) && n >= 1 && n <= 4);
export const isInterval = (n: number) =>
  Number.isInteger(n) && n >= 2 && n <= 52;

export function toRRule(p: Preset): string {
  switch (p.kind) {
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${p.day}`;
    case "everyNWeeks":
      return `FREQ=WEEKLY;INTERVAL=${p.n};BYDAY=${p.day}`;
    case "monthlyDay":
      return `FREQ=MONTHLY;BYMONTHDAY=${p.day}`;
    case "monthlyNth":
      return `FREQ=MONTHLY;BYDAY=${p.nth}${p.day}`;
  }
}

const DAY = "(MO|TU|WE|TH|FR|SA|SU)";

/** Parses only the preset shapes; anything else is null. */
export function parseRRule(rrule: string): Preset | null {
  let m: RegExpMatchArray | null;
  if (rrule === "FREQ=DAILY") return { kind: "daily" };
  if (rrule === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return { kind: "weekdays" };
  if ((m = rrule.match(new RegExp(`^FREQ=WEEKLY;BYDAY=${DAY}$`))))
    return { kind: "weekly", day: m[1] as Weekday };
  if (
    (m = rrule.match(
      new RegExp(`^FREQ=WEEKLY;INTERVAL=(\\d{1,2});BYDAY=${DAY}$`),
    ))
  ) {
    const n = Number(m[1]);
    return isInterval(n)
      ? { kind: "everyNWeeks", n, day: m[2] as Weekday }
      : null;
  }
  if ((m = rrule.match(/^FREQ=MONTHLY;BYMONTHDAY=(-1|\d{1,2})$/))) {
    const day = Number(m[1]);
    return isMonthDay(day) ? { kind: "monthlyDay", day } : null;
  }
  if ((m = rrule.match(new RegExp(`^FREQ=MONTHLY;BYDAY=(-1|\\d)${DAY}$`)))) {
    const nth = Number(m[1]);
    return isNth(nth)
      ? { kind: "monthlyNth", nth, day: m[2] as Weekday }
      : null;
  }
  return null;
}

const ordinal = (n: number) =>
  n === -1 ? "last" : (["1st", "2nd", "3rd", "4th"][n - 1] ?? `${n}th`);

export function describeRecurrence(rrule: string): string | null {
  const p = parseRRule(rrule);
  if (!p) return null;
  switch (p.kind) {
    case "daily":
      return "Daily";
    case "weekdays":
      return "Every weekday";
    case "weekly":
      return `Weekly on ${DAY_NAMES[p.day]}`;
    case "everyNWeeks":
      return `Every ${p.n} weeks on ${DAY_NAMES[p.day]}`;
    case "monthlyDay":
      return p.day === -1
        ? "Monthly on the last day"
        : `Monthly on day ${p.day}`;
    case "monthlyNth":
      return `Monthly on the ${ordinal(p.nth)} ${DAY_NAMES[p.day]}`;
  }
}

/** The nth (1–4, or -1 = last) given weekday of a month. */
function nthWeekdayOf(
  month: Temporal.PlainYearMonth,
  nth: number,
  dow: number,
) {
  if (nth === -1) {
    const last = month.toPlainDate({ day: month.daysInMonth });
    return last.subtract({ days: (last.dayOfWeek - dow + 7) % 7 });
  }
  const first = month.toPlainDate({ day: 1 });
  return first.add({ days: ((dow - first.dayOfWeek + 7) % 7) + (nth - 1) * 7 });
}

/** First scheduled date strictly after `date`. */
function nextDate(p: Preset, date: Temporal.PlainDate): Temporal.PlainDate {
  switch (p.kind) {
    case "daily":
      return date.add({ days: 1 });
    case "weekdays": {
      let d = date.add({ days: 1 });
      while (d.dayOfWeek > 5) d = d.add({ days: 1 });
      return d;
    }
    case "weekly":
    case "everyNWeeks": {
      const dow = isoDow(p.day);
      // Keep the every-N cadence when already on the scheduled weekday.
      if (p.kind === "everyNWeeks" && date.dayOfWeek === dow)
        return date.add({ weeks: p.n });
      return date.add({ days: ((dow - date.dayOfWeek + 6) % 7) + 1 });
    }
    case "monthlyDay":
    case "monthlyNth": {
      const inMonth = (ym: Temporal.PlainYearMonth) =>
        p.kind === "monthlyDay"
          ? ym.toPlainDate({ day: p.day === -1 ? ym.daysInMonth : p.day })
          : nthWeekdayOf(ym, p.nth, isoDow(p.day));
      const ym = date.toPlainYearMonth();
      const candidate = inMonth(ym);
      return Temporal.PlainDate.compare(candidate, date) > 0
        ? candidate
        : inMonth(ym.add({ months: 1 }));
    }
  }
}

/**
 * Next due instant for a recurring task (D-7, schedule-based): keep the local
 * wall-clock time of `prevDueAt` in `tz` (the task's recurrence_tz, D-5), step
 * through scheduled dates, and return the first that is after both `prevDueAt`
 * and `now`, so overdue recurring tasks don't pile up.
 */
export function nextOccurrence(
  rrule: string,
  tz: string,
  prevDueAt: Date,
  now: Date,
): Date {
  const preset = parseRRule(rrule);
  if (!preset) throw new Error("Unsupported recurrence rule");

  const prev = toZoned(prevDueAt, tz).toPlainDateTime();
  const time = prev.toPlainTime();
  let date = prev.toPlainDate();
  for (let i = 0; i < 10_000; i++) {
    date = nextDate(preset, date);
    const candidate = new Date(
      date
        .toPlainDateTime(time)
        .toZonedDateTime(tz, { disambiguation: "compatible" })
        .epochMilliseconds,
    );
    if (candidate > prevDueAt && candidate > now) return candidate;
  }
  throw new Error("No next occurrence found");
}
