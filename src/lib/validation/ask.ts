import { z } from "zod";

import { isValidDate } from "@/lib/time/zones";

import { TASK_PRIORITIES, TASK_STATUSES } from "./task";

// Ask ActionDesk (docs/plan.md §3.3, §3.4). Tool inputs come from the model and
// chat history comes from the browser: both are untrusted and parsed here.

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(isValidDate, "Not a real date");
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");

export const searchTasksInput = z.strictObject({
  query: z.string().trim().max(200),
  status: z.enum(TASK_STATUSES).nullable(),
  project_id: z.uuid().nullable(),
});

export const listOverdueInput = z.strictObject({});

export const projectSummaryInput = z.strictObject({
  project_id: z.uuid(),
});

export const createTaskInput = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    due_date: localDate.nullable(),
    due_time: localTime.nullable(),
    project_id: z.uuid().nullable(),
    priority: z.enum(TASK_PRIORITIES),
  })
  .refine((t) => t.due_time === null || t.due_date !== null, {
    message: "due_time needs a due_date",
    path: ["due_time"],
  });

/** What the UI shows as a card, and sends back to confirmCreateTask. */
export const createTaskProposalSchema = z.strictObject({
  title: z.string(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  priority: z.enum(TASK_PRIORITIES),
});

export type CreateTaskProposal = z.infer<typeof createTaskProposalSchema>;

export const CHAT_TURN_MAX = 4000;
export const CHAT_TURNS_MAX = 20;

/**
 * Chat history from the browser: text turns only (trust boundary 8). Tool
 * calls and results are never accepted from the client; tools re-run.
 */
export const askInputSchema = z.strictObject({
  history: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        text: z.string().trim().min(1).max(CHAT_TURN_MAX),
      }),
    )
    .max(CHAT_TURNS_MAX),
  question: z
    .string()
    .trim()
    .min(1, "Ask something first")
    .max(CHAT_TURN_MAX, "At most 4,000 characters"),
});

export type ChatTurn = z.infer<typeof askInputSchema>["history"][number];
