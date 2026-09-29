import type { ActionResult } from "@/lib/action-result";

export type TaskAction = (
  prev: ActionResult<{ id: string }> | null,
  formData: FormData,
) => Promise<ActionResult<{ id: string }>>;

export type RowAction = (formData: FormData) => Promise<void>;

export type TaskRowData = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  due_at: string | null;
  recurrence: string | null;
  project: { id: string; name: string } | null;
};

export const fieldClass = "h-9 rounded-md border bg-background px-3 text-sm";

export const PRIORITY_LABELS = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
} as const;
export const STATUS_LABELS = {
  todo: "To do",
  doing: "Doing",
  done: "Done",
} as const;
