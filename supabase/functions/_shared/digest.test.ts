import { describe, expect, it } from "vitest";

// Relative: the @/ alias is for src/ only. This is the drift guard against the app.
import { costUsd } from "../../../src/lib/llm/pricing";

import {
  DIGEST_PRICES,
  digestCostUsd,
  digestSchema,
  digestUserMessage,
  isEmptyWeek,
  renderDigestEmail,
  type DigestData,
} from "./digest";

const data: DigestData = {
  workspace: "Team <HQ>",
  completed: [{ title: "Ship v1", project: null }],
  overdue: [
    {
      title: '<img src=x onerror="alert(1)">',
      project: null,
      due: "2026-10-01",
    },
  ],
  upcoming: [],
};

describe("digest", () => {
  it("knows an empty week", () => {
    expect(
      isEmptyWeek({ workspace: "W", completed: [], overdue: [], upcoming: [] }),
    ).toBe(true);
    expect(isEmptyWeek(data)).toBe(false);
  });

  it("validates the model's output", () => {
    expect(
      digestSchema.safeParse({ summary: "ok", highlights: [], risks: [] })
        .success,
    ).toBe(true);
    expect(
      digestSchema.safeParse({ summary: "", highlights: [], risks: [] })
        .success,
    ).toBe(false);
    expect(
      digestSchema.safeParse({
        summary: "x",
        highlights: Array(6).fill("a"),
        risks: [],
      }).success,
    ).toBe(false);
    expect(
      digestSchema.safeParse({
        summary: "x",
        highlights: [],
        risks: [],
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it("puts the task data inside the random tag", () => {
    const msg = digestUserMessage(data, "2026-10-05", "data-abc123");
    expect(msg).toMatch(/<data-abc123>\n[\s\S]*Ship v1[\s\S]*<\/data-abc123>/);
  });

  it("escapes model output and task titles in the HTML email", () => {
    const email = renderDigestEmail(
      data,
      {
        summary: "<b>Great</b> week",
        highlights: ["<script>x</script>"],
        risks: [],
      },
      "2026-10-05",
      "https://app.example",
    );
    expect(email.html).not.toMatch(/<b>|<script>|<img/);
    expect(email.html).toContain("&lt;b&gt;Great&lt;/b&gt; week");
    expect(email.html).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(email.text).toContain("<b>Great</b> week"); // plain text part is text
    expect(email.subject).toBe("Team <HQ>: your week (2026-10-05)");
  });

  it("prices digest calls like the app does (R-7 drift guard)", () => {
    for (const model of Object.keys(DIGEST_PRICES)) {
      const u = {
        input_tokens: 12_345,
        output_tokens: 678,
        cache_read_input_tokens: 1_000,
      };
      expect(digestCostUsd(model, u)).toBe(costUsd(model, u));
    }
  });
});
