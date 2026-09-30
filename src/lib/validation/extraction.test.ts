import { describe, expect, it } from "vitest";

import { extractedTaskSchema, parseReviewedTask } from "./extraction";

const ok = {
  title: "Send the deck",
  assignee: "me",
  due_date: "2026-10-09",
  due_time: "15:00",
  project_id: null,
  confidence: 0.8,
  source_quote: "send the deck by Friday 3pm",
};

describe("extractedTaskSchema", () => {
  it("accepts a valid call", () => {
    expect(extractedTaskSchema.safeParse(ok).success).toBe(true);
  });

  it.each([
    ["an unreal date", { due_date: "2026-02-30" }],
    ["a bad time", { due_time: "3pm" }],
    ["a time without a date", { due_date: null }],
    ["confidence above 1", { confidence: 1.5 }],
    ["an empty title", { title: "  " }],
    ["a non-uuid project", { project_id: "website" }],
    ["an extra field", { status: "done" }],
  ])("rejects %s", (_, over) => {
    expect(extractedTaskSchema.safeParse({ ...ok, ...over }).success).toBe(
      false,
    );
  });

  it("cuts an over-long quote instead of rejecting it", () => {
    const r = extractedTaskSchema.parse({
      ...ok,
      source_quote: "x".repeat(900),
    });
    expect(r.source_quote).toHaveLength(500);
  });
});

describe("parseReviewedTask", () => {
  const row = {
    title: "Send the deck",
    assignee: "me",
    dueDate: "2026-10-09",
    dueTime: null,
    projectId: null,
    sourceQuote: "send the deck",
  };

  it("uses the manual task form's rules", () => {
    const r = parseReviewedTask(row);
    expect(r.success && r.data).toMatchObject({
      title: "Send the deck",
      dueDate: "2026-10-09",
      dueTime: null,
      recurrence: null,
    });
  });

  it("rejects what the task form rejects", () => {
    expect(parseReviewedTask({ ...row, title: "" }).success).toBe(false);
    expect(
      parseReviewedTask({ ...row, dueDate: null, dueTime: "09:00" }).success,
    ).toBe(false);
    expect(parseReviewedTask({ ...row, projectId: "nope" }).success).toBe(
      false,
    );
  });
});
