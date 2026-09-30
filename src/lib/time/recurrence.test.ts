import { describe, expect, it } from "vitest";

import {
  describeRecurrence,
  ruleTime,
  nextOccurrence,
  parseRRule,
  toRRule,
  type Preset,
} from "./recurrence";
import { toUtc } from "./zones";

const LA = "America/Los_Angeles";

describe("RRULE presets", () => {
  const cases: [Preset, string][] = [
    [{ kind: "daily" }, "FREQ=DAILY"],
    [{ kind: "weekdays" }, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    [{ kind: "weekly", day: "TU" }, "FREQ=WEEKLY;BYDAY=TU"],
    [
      { kind: "everyNWeeks", n: 2, day: "FR" },
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    ],
    [{ kind: "monthlyDay", day: 15 }, "FREQ=MONTHLY;BYMONTHDAY=15"],
    [{ kind: "monthlyDay", day: -1 }, "FREQ=MONTHLY;BYMONTHDAY=-1"],
    [{ kind: "monthlyNth", nth: 2, day: "TU" }, "FREQ=MONTHLY;BYDAY=2TU"],
    [{ kind: "monthlyNth", nth: -1, day: "FR" }, "FREQ=MONTHLY;BYDAY=-1FR"],
  ];

  it.each(cases)("%j ↔ %s", (preset, rrule) => {
    expect(toRRule(preset)).toBe(rrule);
    expect(parseRRule(rrule)).toEqual(preset);
  });

  it.each([
    "FREQ=YEARLY",
    "FREQ=WEEKLY",
    "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR",
    "FREQ=WEEKLY;INTERVAL=53;BYDAY=FR",
    "FREQ=MONTHLY;BYMONTHDAY=29",
    "FREQ=MONTHLY;BYDAY=5TU",
    "FREQ=DAILY;COUNT=3",
    "",
  ])("rejects %j", (rrule) => {
    expect(parseRRule(rrule)).toBeNull();
  });

  it("describes presets for the UI", () => {
    expect(describeRecurrence("FREQ=MONTHLY;BYDAY=2TU")).toBe(
      "Monthly on the 2nd Tuesday",
    );
    expect(describeRecurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR")).toBe(
      "Every 2 weeks on Friday",
    );
    expect(describeRecurrence("FREQ=MONTHLY;BYMONTHDAY=-1")).toBe(
      "Monthly on the last day",
    );
  });
});

describe("nextOccurrence (completed on time)", () => {
  const at = (date: string, time = "09:00") => toUtc(date, time, LA);

  it.each([
    ["FREQ=DAILY", "2026-10-06", "2026-10-07"],
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "2026-10-09", "2026-10-12"], // Fri → Mon
    ["FREQ=WEEKLY;BYDAY=TU", "2026-10-06", "2026-10-13"],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=FR", "2026-10-09", "2026-10-23"],
    ["FREQ=MONTHLY;BYMONTHDAY=15", "2026-09-15", "2026-10-15"],
    ["FREQ=MONTHLY;BYMONTHDAY=-1", "2026-09-30", "2026-10-31"],
    ["FREQ=MONTHLY;BYDAY=2TU", "2026-09-08", "2026-10-13"],
    ["FREQ=MONTHLY;BYDAY=-1FR", "2026-09-25", "2026-10-30"],
  ])("%s from %s → %s 09:00 local", (rrule, prev, expected) => {
    expect(nextOccurrence(rrule, LA, at(prev), at(prev))).toEqual(at(expected));
  });

  it("keeps a date-only (23:59) due time", () => {
    expect(
      nextOccurrence(
        "FREQ=DAILY",
        LA,
        at("2026-10-06", "23:59"),
        at("2026-10-06"),
      ),
    ).toEqual(at("2026-10-07", "23:59"));
  });
});

describe("nextOccurrence (completed late, D-7)", () => {
  const at = (date: string, time = "09:00") => toUtc(date, time, LA);

  it("skips to the first occurrence after now, without piling up", () => {
    expect(
      nextOccurrence(
        "FREQ=DAILY",
        LA,
        at("2026-10-06"),
        at("2026-10-09", "05:00"),
      ),
    ).toEqual(at("2026-10-09"));
    expect(
      nextOccurrence(
        "FREQ=WEEKLY;BYDAY=TU",
        LA,
        at("2026-10-06"),
        at("2026-10-20", "10:00"),
      ),
    ).toEqual(at("2026-10-27"));
  });

  it("stays on the every-N-weeks cadence", () => {
    expect(
      nextOccurrence(
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
        LA,
        at("2026-10-09"),
        at("2026-10-24"),
      ),
    ).toEqual(at("2026-11-06"));
  });
});

describe("intended local time in the rule (BYHOUR/BYMINUTE)", () => {
  it("round-trips the time with any preset", () => {
    const rule = toRRule(
      { kind: "monthlyNth", nth: 2, day: "TU" },
      { hour: 9, minute: 5 },
    );
    expect(rule).toBe("FREQ=MONTHLY;BYDAY=2TU;BYHOUR=9;BYMINUTE=5");
    expect(parseRRule(rule)).toEqual({ kind: "monthlyNth", nth: 2, day: "TU" });
    expect(ruleTime(rule)).toEqual({ hour: 9, minute: 5 });
    expect(describeRecurrence(rule)).toBe("Monthly on the 2nd Tuesday");
  });

  it("returns no time for a rule without one", () => {
    expect(ruleTime("FREQ=DAILY")).toBeNull();
  });

  it.each([
    "FREQ=DAILY;BYHOUR=24;BYMINUTE=0",
    "FREQ=DAILY;BYHOUR=2;BYMINUTE=60",
    "FREQ=DAILY;BYHOUR=02;BYMINUTE=30",
    "FREQ=DAILY;BYHOUR=2",
    "FREQ=DAILY;BYMINUTE=30;BYHOUR=2",
    "FREQ=YEARLY;BYHOUR=2;BYMINUTE=30",
  ])("rejects %j (mirrors the DB check)", (rule) => {
    expect(parseRRule(rule)).toBeNull();
    expect(ruleTime(rule)).toBeNull();
  });

  it("uses the rule's time, not the previous occurrence's", () => {
    // Previous occurrence was moved to 10:00 by hand; the rule says 09:00.
    const prev = toUtc("2026-10-06", "10:00", LA);
    const next = nextOccurrence(
      "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      LA,
      prev,
      prev,
    );
    expect(next).toEqual(toUtc("2026-10-07", "09:00", LA));
  });
});
