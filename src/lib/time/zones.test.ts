import { describe, expect, it } from "vitest";

import { toLocalParts, toUtc } from "./zones";

const LA = "America/Los_Angeles";

describe("toUtc", () => {
  it("converts a local date and time in the given zone", () => {
    expect(toUtc("2026-10-07", "09:00", LA).toISOString()).toBe(
      "2026-10-07T16:00:00.000Z",
    );
    expect(toUtc("2026-10-07", "09:00", "Asia/Manila").toISOString()).toBe(
      "2026-10-07T01:00:00.000Z",
    );
  });

  it("treats a missing time as 23:59 local (end of day)", () => {
    expect(toUtc("2026-10-07", null, LA).toISOString()).toBe(
      "2026-10-08T06:59:00.000Z",
    );
  });
});

describe("toLocalParts", () => {
  it("round-trips with toUtc", () => {
    const instant = toUtc("2026-10-07", "09:05", LA);
    expect(toLocalParts(instant, LA)).toEqual({
      date: "2026-10-07",
      time: "09:05",
    });
  });

  it("shows the same instant differently per zone", () => {
    const instant = new Date("2026-10-08T06:30:00Z");
    expect(toLocalParts(instant, LA)).toEqual({
      date: "2026-10-07",
      time: "23:30",
    });
    expect(toLocalParts(instant, "Asia/Manila")).toEqual({
      date: "2026-10-08",
      time: "14:30",
    });
  });
});
