import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it.each([
    ["/settings", "/settings"],
    ["/tasks?view=today#top", "/tasks?view=today#top"],
    ["/projects/123", "/projects/123"],
  ])("keeps the same-origin path %j", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.com",
    "http://127.0.0.1:3000/settings",
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "\\\\evil.com",
    "/\tevil.com",
    "/%0a/evil.com".replace("%0a", "\n"),
    "javascript:alert(1)",
    "settings",
    "evil.com",
  ])("falls back for %j", (next) => {
    expect(safeNextPath(next)).toBe("/tasks");
  });
});
