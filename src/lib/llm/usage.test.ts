import { afterEach, describe, expect, it, vi } from "vitest";

import { dailyCapUsd } from "./usage";

describe("dailyCapUsd", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["", 1],
    ["0.5", 0.5],
    ["0", 0],
    ["abc", 1],
    ["-2", 1],
  ])("LLM_DAILY_CAP_USD=%j gives %d", (raw, cap) => {
    vi.stubEnv("LLM_DAILY_CAP_USD", raw);
    expect(dailyCapUsd()).toBe(cap);
  });
});
