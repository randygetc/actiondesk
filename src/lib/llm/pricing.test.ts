import { describe, expect, it } from "vitest";

import { costUsd, isKnownModel } from "./pricing";

describe("costUsd", () => {
  it("prices input, output and cache tokens per million", () => {
    // Opus 5.5: $4 in, $20 out, $5 cache write, $0.20 cache read.
    expect(
      costUsd("claude-opus-5-5", {
        input_tokens: 1_000_000,
        output_tokens: 100_000,
        cache_creation_input_tokens: 200_000,
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(4 + 2 + 1 + 0.2, 6);
  });

  it("rounds to the six decimals llm_usage stores", () => {
    // 1 input token on Haiku 4.5 = $0.000001.
    expect(
      costUsd("claude-haiku-4-5", { input_tokens: 1, output_tokens: 0 }),
    ).toBe(0.000001);
    expect(
      costUsd("claude-haiku-4-5", { input_tokens: 0, output_tokens: 0 }),
    ).toBe(0);
  });

  it("prices an unknown model at the worst known rate", () => {
    expect(isKnownModel("claude-new-9")).toBe(false);
    expect(
      costUsd("claude-new-9", { input_tokens: 1_000_000, output_tokens: 0 }),
    ).toBe(5);
  });
});
