import { afterEach, describe, expect, it, vi } from "vitest";

import { dailyCapUsd, usageMeter } from "./usage";

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

describe("usageMeter (review #1: aborted calls are charged)", () => {
  const partial = {
    model: "claude-sonnet-5-5",
    input_tokens: 100_000,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  it("charges the in-flight call when no final message arrives", () => {
    const meter = usageMeter("claude-sonnet-5-5");
    meter.partial(partial);
    const s = meter.summary();
    expect(s.input).toBe(100_000);
    // Sonnet 5.5: 100k input at $2/M + 50 output at $10/M.
    expect(s.cost).toBeCloseTo(0.2005, 6);
  });

  it("the final message replaces the partial count", () => {
    const meter = usageMeter("claude-sonnet-5-5");
    meter.partial(partial);
    meter.add({
      model: "claude-sonnet-5-5",
      id: "msg_1",
      usage: { input_tokens: 100_000, output_tokens: 400 },
    } as never);
    expect(meter.summary()).toMatchObject({
      input: 100_000,
      output: 400,
      calls: 1,
    });
  });
});
