import { describe, expect, it } from "vitest";

import { isCronCall } from "./cron-auth.ts";

const SECRET = "a".repeat(20) + "B9_x-".repeat(4); // 40 characters

describe("isCronCall", () => {
  it("accepts exactly Bearer <secret>", () => {
    expect(isCronCall(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses a wrong, missing, truncated or extended token", () => {
    expect(isCronCall(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isCronCall(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isCronCall(SECRET, SECRET)).toBe(false);
    expect(isCronCall(null, SECRET)).toBe(false);
    expect(isCronCall("", SECRET)).toBe(false);
  });

  it("refuses everything when the secret isn't configured", () => {
    expect(isCronCall("Bearer ", "")).toBe(false);
    expect(isCronCall("Bearer undefined", undefined)).toBe(false);
    expect(isCronCall("Bearer short", "short")).toBe(false);
  });
});
