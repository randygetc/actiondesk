import { describe, expect, it } from "vitest";

import { taskFormSchema } from "./task";

const base = {
  title: "Write report",
  notes: "",
  status: "todo",
  priority: "normal",
  projectId: "",
  dueDate: "",
  dueTime: "",
  repeat: "none",
};

const parse = (over: Record<string, string | undefined>) =>
  taskFormSchema.safeParse({ ...base, ...over });

describe("taskFormSchema", () => {
  it("accepts a minimal task and normalizes empty fields to null", () => {
    expect(taskFormSchema.parse(base)).toEqual({
      title: "Write report",
      notes: null,
      status: "todo",
      priority: "normal",
      projectId: null,
      dueDate: null,
      dueTime: null,
      recurrence: null,
    });
  });

  it("trims the title", () => {
    expect(parse({ title: "  x  " }).data?.title).toBe("x");
  });

  it.each([
    ["title", ""],
    ["title", "x".repeat(201)],
    ["notes", "x".repeat(10_001)],
    ["status", "blocked"],
    ["priority", "critical"],
    ["projectId", "not-a-uuid"],
    ["dueDate", "10/07/2026"],
    ["dueDate", "2026-02-30"],
    ["dueTime", "9am"],
  ])("rejects %s = %j", (field, value) => {
    expect(
      parse({
        [field]: value,
        ...(field === "dueTime" ? { dueDate: "2026-10-07" } : {}),
      }).success,
    ).toBe(false);
  });

  it("rejects a time without a date", () => {
    const r = parse({ dueTime: "09:00" });
    expect(r.success).toBe(false);
    expect(r.error?.flatten().fieldErrors.dueDate).toBeDefined();
  });

  it("refuses a recurrence without a due date (mirrors the DB check)", () => {
    const r = parse({ repeat: "daily" });
    expect(r.success).toBe(false);
    expect(r.error?.flatten().fieldErrors.dueDate).toBeDefined();
  });

  it.each([
    [{ repeat: "daily" }, "FREQ=DAILY"],
    [{ repeat: "weekdays" }, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    [{ repeat: "weekly", weekday: "TU" }, "FREQ=WEEKLY;BYDAY=TU"],
    [
      { repeat: "everyNWeeks", interval: "2", weekday: "FR" },
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    ],
    [{ repeat: "monthlyDay", monthDay: "15" }, "FREQ=MONTHLY;BYMONTHDAY=15"],
    [{ repeat: "monthlyDay", monthDay: "-1" }, "FREQ=MONTHLY;BYMONTHDAY=-1"],
    [
      { repeat: "monthlyNth", nth: "2", weekday: "TU" },
      "FREQ=MONTHLY;BYDAY=2TU",
    ],
  ])("builds the RRULE for %j", (fields, rrule) => {
    expect(parse({ dueDate: "2026-10-06", ...fields }).data?.recurrence).toBe(
      rrule,
    );
  });

  it.each([
    { repeat: "weekly" },
    { repeat: "everyNWeeks", interval: "1", weekday: "FR" },
    { repeat: "monthlyDay", monthDay: "29" },
    { repeat: "monthlyNth", nth: "5", weekday: "TU" },
    { repeat: "yearly" },
  ])("rejects the incomplete or invalid preset %j", (fields) => {
    expect(parse({ dueDate: "2026-10-06", ...fields }).success).toBe(false);
  });
});
