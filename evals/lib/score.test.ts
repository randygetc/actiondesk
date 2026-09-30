import { describe, expect, it } from "vitest";

import { matchTasks, scoreCase, titleSimilarity } from "./score";
import type { CaseContext, ScoredTask } from "./schema";

const P1 = "00000000-0000-4000-8000-000000000001";
const ctx: CaseContext = {
  now: "2026-10-30T16:00:00-07:00",
  timezone: "America/Los_Angeles",
  userName: "Randy",
  projects: [{ id: P1, name: "Website" }],
  includeOthers: false,
};

const task = (over: Partial<ScoredTask> = {}): ScoredTask => ({
  title: "Run the payroll export",
  assignee: "me",
  due_date: "2026-11-02",
  due_time: "09:00",
  project_id: null,
  ...over,
});

describe("titleSimilarity", () => {
  it("ignores case, punctuation and stopwords", () => {
    expect(
      titleSimilarity("Send the homepage copy!", "send homepage copy"),
    ).toBe(1);
  });

  it("scores overlap against the shorter title", () => {
    // {sign, vendor, contract, send, back, ana} vs {sign, return, vendor, contract}: 3 of 4.
    expect(
      titleSimilarity(
        "Sign the vendor contract and send it back to Ana",
        "Sign and return the vendor contract",
      ),
    ).toBeCloseTo(0.75);
  });

  it("doesn't pair titles that share only a verb", () => {
    expect(titleSimilarity("Send the deck", "Send the report")).toBe(0.5);
  });

  it("scores unrelated titles 0", () => {
    expect(
      titleSimilarity("Order office chairs", "Renew SSL certificate"),
    ).toBe(0);
  });
});

describe("matchTasks", () => {
  it("pairs each task at most once", () => {
    const expected = [task()];
    const actual = [task(), task({ title: "Run payroll export" })];
    expect(matchTasks(expected, actual)).toHaveLength(1);
  });

  it("leaves dissimilar titles unpaired", () => {
    expect(matchTasks([task()], [task({ title: "Order chairs" })])).toEqual([]);
  });
});

describe("scoreCase", () => {
  it("scores a perfect answer 1", () => {
    const s = scoreCase(ctx, [task()], [task()]);
    expect(s.score).toBe(1);
  });

  it("scores an empty case 1 only when nothing is extracted", () => {
    expect(scoreCase(ctx, [], []).score).toBe(1);
    expect(scoreCase(ctx, [], [task()]).score).toBe(0);
  });

  it("a wrong date lowers only the due field", () => {
    const s = scoreCase(ctx, [task()], [task({ due_time: "10:00" })]);
    expect(s.f1).toEqual({ title: 1, assignee: 1, due: 0, project: 1 });
    expect(s.score).toBe(0.75);
  });

  it("compares due dates as instants: no time equals 23:59", () => {
    const s = scoreCase(
      ctx,
      [task({ due_time: null })],
      [task({ due_time: "23:59" })],
    );
    expect(s.f1.due).toBe(1);
  });

  it("a missing date is wrong when one was expected", () => {
    const s = scoreCase(
      ctx,
      [task()],
      [task({ due_date: null, due_time: null })],
    );
    expect(s.f1.due).toBe(0);
  });

  it("treats the user's name as 'me'", () => {
    const s = scoreCase(ctx, [task()], [task({ assignee: "randy" })]);
    expect(s.f1.assignee).toBe(1);
  });

  it("a wrong project lowers only the project field", () => {
    const s = scoreCase(ctx, [task({ project_id: P1 })], [task()]);
    expect(s.f1.project).toBe(0);
    expect(s.f1.title).toBe(1);
  });

  it("an extra task lowers precision, a missing one lowers recall", () => {
    const other = task({
      title: "Submit the expense report",
      due_date: "2026-11-01",
      due_time: null,
    });
    const extra = scoreCase(ctx, [task()], [task(), other]);
    const missing = scoreCase(ctx, [task(), other], [task()]);
    // Both: 1 correct of 1 expected / 2 actual (or the reverse): F1 = 2/3.
    expect(extra.f1.title).toBeCloseTo(2 / 3);
    expect(missing.f1.title).toBeCloseTo(2 / 3);
  });
});
