import { z } from "zod";

// Eval case files (evals/README.md). Validated on load, so a typo in a case
// fails loudly instead of skewing the score.

const localDate = z.iso.date();
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm");

export const caseSchema = z.strictObject({
  now: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1),
  userName: z.string().min(1),
  projects: z.array(z.strictObject({ id: z.uuid(), name: z.string().min(1) })),
  includeOthers: z.boolean(),
});

/**
 * One task as scored. Expected tasks use this shape, and extraction output is
 * mapped onto it (dates are local to the case's timezone, D-20).
 */
export const scoredTaskSchema = z.strictObject({
  title: z.string().min(1),
  assignee: z.string().min(1),
  due_date: localDate.nullable(),
  due_time: localTime.nullable(),
  project_id: z.uuid().nullable(),
});

export const expectedSchema = z.array(scoredTaskSchema);

export type CaseContext = z.infer<typeof caseSchema>;
export type ScoredTask = z.infer<typeof scoredTaskSchema>;

export type EvalCase = {
  name: string;
  dir: string;
  context: CaseContext;
  input: { kind: "text"; text: string } | { kind: "pdf"; path: string };
  expected: ScoredTask[];
};
