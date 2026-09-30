import { describe, expect, it } from "vitest";

import { usageByDay, type UsageRow } from "./usage-report";

const row = (over: Partial<UsageRow>): UsageRow => ({
  created_at: "2026-10-06T01:00:00Z",
  feature: "extract",
  outcome: "ok",
  cost_usd: 0.01,
  input_tokens: 100,
  output_tokens: 10,
  cached_tokens: 50,
  user_id: "u1",
  ...over,
});

describe("usageByDay", () => {
  it("groups by local day and feature, newest first", () => {
    const lines = usageByDay(
      [
        row({}),
        row({ user_id: "u2", cost_usd: 0.02 }),
        row({ feature: "ask", outcome: "capped", cost_usd: 0 }),
        // 2026-10-05 20:00 UTC is already Oct 6 in Manila; 15:00 UTC is Oct 5.
        row({ created_at: "2026-10-05T15:00:00Z", outcome: "error" }),
      ],
      "Asia/Manila",
    );
    expect(lines).toEqual([
      expect.objectContaining({
        day: "2026-10-06",
        feature: "ask",
        calls: 1,
        capped: 1,
      }),
      expect.objectContaining({
        day: "2026-10-06",
        feature: "extract",
        calls: 2,
        users: 2,
        costUsd: 0.03,
        cachedTokens: 100,
      }),
      expect.objectContaining({
        day: "2026-10-05",
        feature: "extract",
        calls: 1,
        failed: 1,
      }),
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(usageByDay([], "UTC")).toEqual([]);
  });
});
