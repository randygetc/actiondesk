import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadCases } from "./cases";
import { formatReport, runEval } from "./run";

const root = fileURLToPath(new URL("../extraction", import.meta.url));

describe("the committed cases", () => {
  const cases = loadCases(root);

  it("all load and validate, and _template is skipped", () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.map((c) => c.name)).not.toContain("_template");
  });

  it("score 1 against their own expected answers", async () => {
    const result = await runEval(cases, async (c) => c.expected);
    expect(result.overall).toBe(1);
  });
});

describe("loadCases", () => {
  function tempCase(caseJson: unknown, expected: unknown) {
    const dir = mkdtempSync(join(tmpdir(), "eval-"));
    mkdirSync(join(dir, "bad"));
    writeFileSync(join(dir, "bad", "case.json"), JSON.stringify(caseJson));
    writeFileSync(join(dir, "bad", "expected.json"), JSON.stringify(expected));
    writeFileSync(join(dir, "bad", "input.txt"), "note");
    return dir;
  }
  const good = {
    now: "2026-10-06T09:15:00+08:00",
    timezone: "Asia/Manila",
    userName: "Randy",
    projects: [],
    includeOthers: false,
  };

  it("names the file and field of a malformed case", () => {
    const dir = tempCase(good, [
      {
        title: "x",
        assignee: "me",
        due_date: "2026-13-01",
        due_time: null,
        project_id: null,
      },
    ]);
    expect(() => loadCases(dir)).toThrow(/bad\/expected\.json: 0\.due_date/);
  });

  it("rejects a project_id that isn't in the case", () => {
    const dir = tempCase(good, [
      {
        title: "x",
        assignee: "me",
        due_date: null,
        due_time: null,
        project_id: "00000000-0000-4000-8000-000000000009",
      },
    ]);
    expect(() => loadCases(dir)).toThrow(/unknown project_id/);
  });
});

describe("runEval", () => {
  const cases = loadCases(root).slice(0, 3);

  it("leaves cases without a recording out of the overall score", async () => {
    const result = await runEval(cases, async () => null);
    expect(result.overall).toBeNull();
    expect(formatReport(result)).toContain("(no recording)");
  });

  it("counts an extractor error as 0", async () => {
    const result = await runEval(cases, async (c) => {
      if (c.name === cases[0].name) throw new Error("boom");
      return c.expected;
    });
    expect(result.overall).toBeCloseTo(2 / 3);
    expect(formatReport(result)).toContain("ERROR boom");
  });
});
