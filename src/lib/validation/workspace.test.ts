import { describe, expect, it } from "vitest";

import {
  inviteSchema,
  inviteTokenSchema,
  workspaceNameSchema,
} from "./workspace";

describe("workspace forms", () => {
  it("normalizes invite emails and limits roles", () => {
    expect(
      inviteSchema.parse({ email: " Ana@Example.COM ", role: "viewer" }),
    ).toEqual({
      email: "ana@example.com",
      role: "viewer",
    });
    expect(
      inviteSchema.safeParse({ email: "nope", role: "member" }).success,
    ).toBe(false);
    expect(
      inviteSchema.safeParse({ email: "a@b.co", role: "owner" }).success,
    ).toBe(false);
  });

  it("accepts only 64-hex tokens", () => {
    expect(inviteTokenSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(inviteTokenSchema.safeParse("A".repeat(64)).success).toBe(false);
    expect(inviteTokenSchema.safeParse("a".repeat(63)).success).toBe(false);
  });

  it("trims workspace names", () => {
    expect(workspaceNameSchema.parse("  Team ")).toBe("Team");
    expect(workspaceNameSchema.safeParse("   ").success).toBe(false);
  });
});
