import { describe, expect, it } from "vitest";

import {
  archiveProjectSchema,
  createProjectSchema,
  renameProjectSchema,
} from "./project";

const id = "0b6c1a9e-3c1f-4d8e-9a57-3f0f5a2b8c11";

describe("project schemas", () => {
  it("trims the name", () => {
    expect(createProjectSchema.parse({ name: "  Launch  " })).toEqual({
      name: "Launch",
    });
  });

  it.each(["", "   ", "x".repeat(101)])("rejects the name %j", (name) => {
    expect(createProjectSchema.safeParse({ name }).success).toBe(false);
  });

  it("accepts 100 characters", () => {
    expect(
      createProjectSchema.safeParse({ name: "x".repeat(100) }).success,
    ).toBe(true);
  });

  it("requires a uuid id", () => {
    expect(renameProjectSchema.safeParse({ id: "1", name: "A" }).success).toBe(
      false,
    );
    expect(renameProjectSchema.safeParse({ id, name: "A" }).success).toBe(true);
  });

  it("parses the archived flag", () => {
    expect(archiveProjectSchema.parse({ id, archived: "true" }).archived).toBe(
      true,
    );
    expect(archiveProjectSchema.parse({ id, archived: "false" }).archived).toBe(
      false,
    );
    expect(
      archiveProjectSchema.safeParse({ id, archived: "yes" }).success,
    ).toBe(false);
  });
});
