import { afterEach, describe, expect, it, vi } from "vitest";

import { log, REDACTED, redact } from "./log";

describe("log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redacts sensitive field names", () => {
    expect(
      redact({ taskId: "t1", title: "x", accessToken: "y", count: 2 }),
    ).toEqual({
      taskId: "t1",
      title: REDACTED,
      accessToken: REDACTED,
      count: 2,
    });
  });

  it("writes one JSON line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("task.created", { taskId: "t1" });
    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      level: "info",
      event: "task.created",
      taskId: "t1",
    });
  });
});
