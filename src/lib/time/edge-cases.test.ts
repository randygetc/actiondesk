/**
 * Step 1.8: time zone and DST edge cases (docs/plan.md §2.4, friction exercise B).
 * Every case uses a fixed `now`. If one fails, fix src/lib/time/, not the test.
 *
 * Calendar facts used below (America/Los_Angeles, 2026):
 * - DST starts Sun 2026-03-08: 02:00 PST jumps to 03:00 PDT (02:00–02:59 don't exist).
 * - DST ends Sun 2026-11-01: 02:00 PDT falls back to 01:00 PST (01:00–01:59 happen twice).
 * - PDT = UTC−7, PST = UTC−8. Asia/Manila = UTC+8, no DST.
 */
import { describe, expect, it } from "vitest";

import { groupFor, groupTasks } from "./grouping";
import { nextOccurrence } from "./recurrence";
import { toLocalParts, toUtc } from "./zones";

const LA = "America/Los_Angeles";
const MANILA = "Asia/Manila";
const utc = (iso: string) => new Date(iso);

describe("(a) a task due 23:30 local today is Today, not tomorrow", () => {
  // Wed 2026-11-18 (PST). 23:30 local = 07:30 UTC on the 19th.
  const now = toUtc("2026-11-18", "10:00", LA);
  const due = toUtc("2026-11-18", "23:30", LA);

  it("stores 07:30 UTC the next day", () => {
    expect(due.toISOString()).toBe("2026-11-19T07:30:00.000Z");
  });

  it("groups as Today", () => {
    expect(groupFor(due, now, LA)).toBe("today");
  });

  it("is still Today at 23:29 local, and Overdue at 23:31", () => {
    expect(groupFor(due, toUtc("2026-11-18", "23:29", LA), LA)).toBe("today");
    expect(groupFor(due, toUtc("2026-11-18", "23:31", LA), LA)).toBe("overdue");
  });

  it("a date-only task due today (23:59) is Today all day", () => {
    expect(
      groupFor(
        toUtc("2026-11-18", null, LA),
        toUtc("2026-11-18", "23:58", LA),
        LA,
      ),
    ).toBe("today");
  });
});

describe("(b) weekly 09:00 Pacific across the end of DST", () => {
  // Tue 2026-10-27 09:00 PDT = 16:00 UTC. The next Tuesday is after DST ends (Nov 1).
  const prev = utc("2026-10-27T16:00:00Z");

  it("the next occurrence is 09:00 local, so 17:00 UTC", () => {
    const next = nextOccurrence(
      "FREQ=WEEKLY;BYDAY=TU",
      LA,
      prev,
      utc("2026-10-27T16:30:00Z"),
    );
    expect(next.toISOString()).toBe("2026-11-03T17:00:00.000Z");
    expect(toLocalParts(next, LA)).toEqual({
      date: "2026-11-03",
      time: "09:00",
    });
  });

  it("daily 09:00 steps from 16:00 UTC to 17:00 UTC on the switch day", () => {
    const sat = toUtc("2026-10-31", "09:00", LA);
    const sun = nextOccurrence("FREQ=DAILY", LA, sat, sat);
    const mon = nextOccurrence("FREQ=DAILY", LA, sun, sun);
    expect([sat, sun, mon].map((d) => d.toISOString())).toEqual([
      "2026-10-31T16:00:00.000Z",
      "2026-11-01T17:00:00.000Z",
      "2026-11-02T17:00:00.000Z",
    ]);
  });

  it("the same across the start of DST (09:00 stays 09:00: 17:00 → 16:00 UTC)", () => {
    const prevMarch = toUtc("2026-03-03", "09:00", LA); // Tue, PST
    const next = nextOccurrence(
      "FREQ=WEEKLY;BYDAY=TU",
      LA,
      prevMarch,
      prevMarch,
    );
    expect(next.toISOString()).toBe("2026-03-10T16:00:00.000Z");
  });
});

describe("(c) changing the profile zone to Asia/Manila", () => {
  // Wed 2026-11-18 12:00 in LA = Thu 2026-11-19 04:00 in Manila.
  const now = utc("2026-11-18T20:00:00Z");
  const tasks = [
    { id: "overdue", due_at: "2026-11-18T18:00:00.000Z", status: "todo" }, // past in both
    { id: "flipsToToday", due_at: "2026-11-19T10:00:00.000Z", status: "todo" }, // LA Thu 02:00, Manila Thu 18:00
    { id: "flipsToLater", due_at: "2026-11-23T02:00:00.000Z", status: "todo" }, // LA Sun 18:00, Manila Mon 10:00
    { id: "lateTonightLA", due_at: "2026-11-19T07:30:00.000Z", status: "todo" }, // LA Wed 23:30, Manila Thu 15:30
  ];
  const snapshot = JSON.stringify(tasks);
  const grouped = (tz: string) =>
    Object.fromEntries(
      groupTasks(tasks, now, tz).groups.flatMap((g) =>
        g.tasks.map((t) => [t.id, g.group]),
      ),
    );

  it("groups in Los Angeles time", () => {
    expect(grouped(LA)).toEqual({
      overdue: "overdue",
      flipsToToday: "thisWeek",
      flipsToLater: "thisWeek",
      lateTonightLA: "today",
    });
  });

  it("recomputes the groups in Manila time", () => {
    expect(grouped(MANILA)).toEqual({
      overdue: "overdue",
      flipsToToday: "today",
      flipsToLater: "later",
      lateTonightLA: "today",
    });
  });

  it("leaves the stored due_at values unchanged", () => {
    grouped(LA);
    grouped(MANILA);
    expect(JSON.stringify(tasks)).toBe(snapshot);
  });

  it("a recurring 09:00 Pacific task stays 09:00 Pacific after the move (D-5)", () => {
    // recurrence_tz was fixed at creation; the profile zone doesn't change the rule.
    const prev = toUtc("2026-11-17", "09:00", LA);
    const next = nextOccurrence("FREQ=WEEKLY;BYDAY=TU", LA, prev, now);
    expect(toLocalParts(next, LA)).toEqual({
      date: "2026-11-24",
      time: "09:00",
    });
    // Displayed in Manila it's Wednesday 01:00, which is correct: same instant.
    expect(toLocalParts(next, MANILA)).toEqual({
      date: "2026-11-25",
      time: "01:00",
    });
  });
});

describe("(d) monthly on the 2nd Tuesday across a month boundary", () => {
  it("Oct 13 → Nov 10, 09:00 local (and across DST: 16:00 → 17:00 UTC)", () => {
    const prev = toUtc("2026-10-13", "09:00", LA);
    const next = nextOccurrence("FREQ=MONTHLY;BYDAY=2TU", LA, prev, prev);
    expect(toLocalParts(next, LA)).toEqual({
      date: "2026-11-10",
      time: "09:00",
    });
    expect(next.toISOString()).toBe("2026-11-10T17:00:00.000Z");
  });

  it("Dec 8 → Jan 12 across the year boundary", () => {
    const prev = toUtc("2026-12-08", "09:00", LA);
    const next = nextOccurrence("FREQ=MONTHLY;BYDAY=2TU", LA, prev, prev);
    expect(toLocalParts(next, LA)).toEqual({
      date: "2027-01-12",
      time: "09:00",
    });
  });

  it("when the 1st is a Tuesday, the 2nd Tuesday is the 8th (Sep 2026)", () => {
    const prev = toUtc("2026-08-11", "09:00", LA);
    const next = nextOccurrence("FREQ=MONTHLY;BYDAY=2TU", LA, prev, prev);
    expect(toLocalParts(next, LA).date).toBe("2026-09-08");
  });

  it("the last day of the month handles February", () => {
    const prev = toUtc("2027-01-31", "09:00", LA);
    const next = nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=-1", LA, prev, prev);
    expect(toLocalParts(next, LA).date).toBe("2027-02-28");
  });
});

describe("spring forward: nonexistent local times", () => {
  // Rule (documented in zones.ts): a nonexistent wall-clock time moves forward
  // by the length of the gap, so 02:30 on 2026-03-08 in LA becomes 03:30 PDT.
  it("02:30 on the March DST date resolves to 03:30", () => {
    const due = toUtc("2026-03-08", "02:30", LA);
    expect(due.toISOString()).toBe("2026-03-08T10:30:00.000Z");
    expect(toLocalParts(due, LA)).toEqual({
      date: "2026-03-08",
      time: "03:30",
    });
  });

  it("a daily 02:30 task lands at 03:30 on the DST date, then returns to 02:30", () => {
    // As stored by the app: the rule carries the intended local time.
    const rule = "FREQ=DAILY;BYHOUR=2;BYMINUTE=30";
    const sat = toUtc("2026-03-07", "02:30", LA);
    const sun = nextOccurrence(rule, LA, sat, sat);
    const mon = nextOccurrence(rule, LA, sun, sun);
    expect(toLocalParts(sun, LA)).toEqual({
      date: "2026-03-08",
      time: "03:30",
    });
    expect(toLocalParts(mon, LA)).toEqual({
      date: "2026-03-09",
      time: "02:30",
    });
  });
});

describe("a rule without a stored time (fallback)", () => {
  // Documented limitation: without BYHOUR/BYMINUTE the previous occurrence's
  // local time is reused, so a gap shift carries forward. The migration that
  // introduced the time suffix backfilled every existing rule, and the app
  // always writes it, so this path is only a safety net.
  it("carries a spring-forward shift into later occurrences", () => {
    const sat = toUtc("2026-03-07", "02:30", LA);
    const sun = nextOccurrence("FREQ=DAILY", LA, sat, sat);
    const mon = nextOccurrence("FREQ=DAILY", LA, sun, sun);
    expect(toLocalParts(mon, LA)).toEqual({
      date: "2026-03-09",
      time: "03:30",
    });
  });
});

describe("fall back: ambiguous local times", () => {
  it("01:30 on the November DST date resolves to the earlier instant (PDT)", () => {
    expect(toUtc("2026-11-01", "01:30", LA).toISOString()).toBe(
      "2026-11-01T08:30:00.000Z",
    );
  });

  it("a daily 01:30 task happens once on that date, not twice", () => {
    const sat = toUtc("2026-10-31", "01:30", LA);
    const sun = nextOccurrence("FREQ=DAILY", LA, sat, sat);
    const mon = nextOccurrence("FREQ=DAILY", LA, sun, sun);
    expect(toLocalParts(sun, LA)).toEqual({
      date: "2026-11-01",
      time: "01:30",
    });
    expect(toLocalParts(mon, LA)).toEqual({
      date: "2026-11-02",
      time: "01:30",
    });
  });
});

describe("completing after the due date (D-7): no skipped or duplicated occurrences", () => {
  const rule = "FREQ=WEEKLY;BYDAY=TU";
  const prev = toUtc("2026-10-27", "09:00", LA);

  it("completed a day late → the very next Tuesday, not one after", () => {
    const next = nextOccurrence(
      rule,
      LA,
      prev,
      toUtc("2026-10-28", "12:00", LA),
    );
    expect(toLocalParts(next, LA).date).toBe("2026-11-03");
  });

  it("completed on the next due day before 09:00 → that same day's occurrence", () => {
    const next = nextOccurrence(
      rule,
      LA,
      prev,
      toUtc("2026-11-03", "08:00", LA),
    );
    expect(toLocalParts(next, LA)).toEqual({
      date: "2026-11-03",
      time: "09:00",
    });
  });

  it("completed three weeks late → one occurrence in the future, not three overdue ones", () => {
    const next = nextOccurrence(
      rule,
      LA,
      prev,
      toUtc("2026-11-18", "12:00", LA),
    );
    expect(toLocalParts(next, LA).date).toBe("2026-11-24");
  });

  it("is deterministic, so a retry targets the same (series_id, due_at) and the DB dedupes it", () => {
    const now = toUtc("2026-10-28", "12:00", LA);
    const later = toUtc("2026-10-28", "12:05", LA);
    expect(nextOccurrence(rule, LA, prev, now)).toEqual(
      nextOccurrence(rule, LA, prev, later),
    );
  });
});
