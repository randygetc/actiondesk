import { z } from "zod";

import { isValidDate } from "@/lib/time/zones";

import { taskFormSchema } from "./task";

// Extraction output and the review screen's rows (docs/plan.md §3.4, D-20).
// LLM output is untrusted: every add_task call is parsed with extractedTaskSchema
// before it reaches the UI, and every reviewed row is parsed again on save.

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(isValidDate, "Not a real date");
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");

export const SOURCE_QUOTE_MAX = 500;

/** One add_task call from the model. Dates are local to the user's zone. */
export const extractedTaskSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    assignee: z.string().trim().min(1).max(200),
    due_date: localDate.nullable(),
    due_time: localTime.nullable(),
    project_id: z.uuid().nullable(),
    confidence: z.number().min(0).max(1),
    // Over-long quotes are cut rather than costing a retry.
    source_quote: z
      .string()
      .trim()
      .transform((s) => s.slice(0, SOURCE_QUOTE_MAX)),
  })
  .refine((t) => t.due_time === null || t.due_date !== null, {
    message: "due_time needs a due_date",
    path: ["due_time"],
  });

export type ExtractedTask = z.output<typeof extractedTaskSchema>;

/** A row the user accepted on the review screen. */
export const reviewedTaskSchema = z.strictObject({
  title: z.string(),
  assignee: z.string().trim().max(200).nullable(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  projectId: z.string().nullable(),
  sourceQuote: z.string().trim().max(SOURCE_QUOTE_MAX).nullable(),
});

export const saveReviewedSchema = z.array(reviewedTaskSchema).min(1).max(50);

export type ReviewedTask = z.infer<typeof reviewedTaskSchema>;

/**
 * Validates a reviewed row with the same schema as the manual task form, so
 * an extracted task passes exactly the checks a typed one does.
 */
export function parseReviewedTask(row: ReviewedTask) {
  return taskFormSchema.safeParse({
    title: row.title,
    status: "todo",
    priority: "normal",
    projectId: row.projectId ?? "",
    dueDate: row.dueDate ?? "",
    dueTime: row.dueTime ?? "",
    repeat: "none",
  });
}

export const NOTE_MAX = 20_000;

/** What the capture form sends to extractTasks. */
export const captureInputSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1, "Paste some notes first")
    .max(NOTE_MAX, `At most ${NOTE_MAX.toLocaleString("en-US")} characters`),
  includeOthers: z.boolean(),
});

export const attachmentIdSchema = z.uuid();

export const extractAttachmentSchema = z.strictObject({
  attachmentId: attachmentIdSchema,
  includeOthers: z.boolean(),
});
