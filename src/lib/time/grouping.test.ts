import { describe, expect, it } from "vitest";

import { groupBounds, groupFor, groupTasks } from "./grouping";
import { toUtc } from "./zones";

const LA = "America/Los_Angeles";
// Wednesday 2026-10-07 10:00 Pacific.
const now = toUtc("2026-10-07", "10:00", LA);

describe("groupFor", () => {
  it.each([
    ["2026-10-07", "09:00", "overdue"],
    ["2026-10-06", "23:59", "overdue"],
    ["2026-10-07", "10:30", "today"],
    ["2026-10-07", "23:30", "today"],
    ["2026-10-08", "00:00", "thisWeek"],
    ["2026-10-11", "23:59", "thisWeek"], // Sunday ends the ISO week
    ["2026-10-12", "00:00", "later"], // next Monday
    ["2026-12-25", "09:00", "later"],
  ] as const)("%s %s → %s", (date, time, expected) => {
    expect(groupFor(toUtc(date, time, LA), now, LA)).toBe(expected);
  });

  it("puts tasks without a due date in noDate", () => {
    expect(groupFor(null, now, LA)).toBe("noDate");
  });

  it("on Sunday, 'this week' is empty and Monday is later", () => {
    const sunday = toUtc("2026-10-11", "10:00", LA);
    expect(groupFor(toUtc("2026-10-11", "18:00", LA), sunday, LA)).toBe(
      "today",
    );
    expect(groupFor(toUtc("2026-10-12", "09:00", LA), sunday, LA)).toBe(
      "later",
    );
  });

  it("on Monday, the following Sunday is still this week", () => {
    const monday = toUtc("2026-10-12", "08:00", LA);
    expect(groupFor(toUtc("2026-10-18", "09:00", LA), monday, LA)).toBe(
      "thisWeek",
    );
  });
});

describe("groupTasks", () => {
  const t = (id: string, due: string | null, status = "todo") => ({
    id,
    due_at: due,
    status,
  });

  it("orders groups, sorts by due date inside each, and separates done tasks", () => {
    const tasks = [
      t("later", "2026-12-01T17:00:00Z"),
      t("today-late", "2026-10-08T05:00:00Z"),
      t("today-early", "2026-10-07T20:00:00Z"),
      t("nodate", null),
      t("done", "2026-10-07T20:00:00Z", "done"),
      t("overdue", "2026-10-01T16:00:00Z"),
    ];
    const { groups, done } = groupTasks(tasks, now, LA);
    expect(groups.map((g) => [g.group, g.tasks.map((x) => x.id)])).toEqual([
      ["overdue", ["overdue"]],
      ["today", ["today-early", "today-late"]],
      ["later", ["later"]],
      ["noDate", ["nodate"]],
    ]);
    expect(done.map((x) => x.id)).toEqual(["done"]);
  });
});

describe("groupBounds (the tasks page queries groups by these ranges)", () => {
  const byBounds = (due: Date | null, now: Date, tz: string) => {
    if (!due) return "noDate";
    const { todayEnd, weekEnd } = groupBounds(now, tz);
    if (due < now) return "overdue";
    if (due < todayEnd) return "today";
    return due < weekEnd ? "thisWeek" : "later";
  };

  it.each([
    "America/Los_Angeles",
    "Asia/Manila",
    "Europe/London",
    "Australia/Sydney",
  ])(
    "agrees with groupFor for every hour around both DST changes, any day of the week (%s)",
    (tz) => {
      // Each `now` is a different weekday/hour; each due date spans 10 days on.
      for (const start of [
        "2026-03-05T00:00:00Z",
        "2026-10-28T00:00:00Z",
        "2026-04-01T00:00:00Z",
      ]) {
        for (let n = 0; n < 7 * 24; n += 7) {
          const now = new Date(Date.parse(start) + n * 3600_000 + 17 * 60_000);
          for (let h = -6; h < 10 * 24; h += 5) {
            const due = new Date(now.getTime() + h * 3600_000);
            expect(byBounds(due, now, tz)).toBe(groupFor(due, now, tz));
          }
        }
      }
    },
  );
});
