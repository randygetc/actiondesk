import { z } from "zod";

import {
  isInterval,
  isMonthDay,
  isNth,
  toRRule,
  WEEKDAYS,
  type Preset,
  type Weekday,
} from "@/lib/time/recurrence";
import { isValidDate } from "@/lib/time/zones";

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const REPEAT_KINDS = [
  "none",
  "daily",
  "weekdays",
  "weekly",
  "everyNWeeks",
  "monthlyDay",
  "monthlyNth",
] as const;

/** Form fields arrive as strings; empty means "not set". */
const blankToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToNull, schema.nullable().optional());

const intIn = (check: (n: number) => boolean, message: string) =>
  z.coerce.number().refine(check, message);

export const taskIdSchema = z.uuid("Invalid task");

export const taskFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(200, "At most 200 characters"),
    notes: optional(z.string().max(10_000, "At most 10,000 characters")),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    projectId: optional(z.uuid("Invalid project")),
    dueDate: optional(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
        .refine(isValidDate, "Not a real date"),
    ),
    dueTime: optional(
      z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
    ),
    repeat: z.enum(REPEAT_KINDS),
    weekday: optional(z.enum(WEEKDAYS)),
    interval: optional(intIn(isInterval, "Every 2 to 52 weeks")),
    monthDay: optional(intIn(isMonthDay, "Day 1–28 or last")),
    nth: optional(intIn(isNth, "1st–4th or last")),
  })
  .superRefine((v, ctx) => {
    const need = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (v.dueTime && !v.dueDate) need("dueDate", "Add a date for this time");
    // Mirrors the DB check: recurrence requires a due date.
    if (v.repeat !== "none" && !v.dueDate)
      need("dueDate", "Repeating tasks need a due date");
    if (
      ["weekly", "everyNWeeks", "monthlyNth"].includes(v.repeat) &&
      !v.weekday
    )
      need("weekday", "Choose a day");
    if (v.repeat === "everyNWeeks" && v.interval == null)
      need("interval", "Choose how many weeks");
    if (v.repeat === "monthlyDay" && v.monthDay == null)
      need("monthDay", "Choose a day");
    if (v.repeat === "monthlyNth" && v.nth == null)
      need("nth", "Choose which week");
  })
  .transform((v) => ({
    title: v.title,
    notes: v.notes ?? null,
    status: v.status,
    priority: v.priority,
    projectId: v.projectId ?? null,
    dueDate: v.dueDate ?? null,
    dueTime: v.dueDate ? (v.dueTime ?? null) : null,
    recurrence: presetFrom(v),
  }));

function presetFrom(v: {
  repeat: (typeof REPEAT_KINDS)[number];
  weekday?: Weekday | null;
  interval?: number | null;
  monthDay?: number | null;
  nth?: number | null;
}): string | null {
  const day = v.weekday as Weekday;
  const preset: Preset | null =
    v.repeat === "daily"
      ? { kind: "daily" }
      : v.repeat === "weekdays"
        ? { kind: "weekdays" }
        : v.repeat === "weekly"
          ? { kind: "weekly", day }
          : v.repeat === "everyNWeeks"
            ? { kind: "everyNWeeks", n: v.interval!, day }
            : v.repeat === "monthlyDay"
              ? { kind: "monthlyDay", day: v.monthDay! }
              : v.repeat === "monthlyNth"
                ? { kind: "monthlyNth", nth: v.nth!, day }
                : null;
  return preset ? toRRule(preset) : null;
}

export type TaskForm = z.output<typeof taskFormSchema>;
