import type { ActionResult } from "@/lib/action-result";

export type ProjectAction = (
  prev: ActionResult<{ id: string }> | null,
  formData: FormData,
) => Promise<ActionResult<{ id: string }>>;

export const fieldClass = "h-9 rounded-md border bg-background px-3 text-sm";
