import { describe, expect, it } from "vitest";

import { updateProfileSchema } from "./profile";

describe("updateProfileSchema", () => {
  it("accepts a known zone and trims the name", () => {
    expect(
      updateProfileSchema.parse({
        displayName: "  Al  ",
        timezone: "Europe/Berlin",
      }),
    ).toEqual({ displayName: "Al", timezone: "Europe/Berlin" });
  });

  it("accepts UTC", () => {
    expect(
      updateProfileSchema.safeParse({ displayName: "", timezone: "UTC" })
        .success,
    ).toBe(true);
  });

  it("maps an empty name to null", () => {
    expect(
      updateProfileSchema.parse({ displayName: " ", timezone: "UTC" })
        .displayName,
    ).toBeNull();
  });

  it.each(["Mars/Olympus_Mons", "", "PST", "america/los_angeles"])(
    "rejects the zone %j",
    (timezone) => {
      expect(
        updateProfileSchema.safeParse({ displayName: "", timezone }).success,
      ).toBe(false);
    },
  );

  it("rejects a name over 100 characters", () => {
    expect(
      updateProfileSchema.safeParse({
        displayName: "x".repeat(101),
        timezone: "UTC",
      }).success,
    ).toBe(false);
  });
});
