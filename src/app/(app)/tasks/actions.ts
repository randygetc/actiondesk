"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { nextOccurrence } from "@/lib/time/recurrence";
import { toUtc } from "@/lib/time/zones";
import { taskFormSchema, taskIdSchema } from "@/lib/validation/task";
import { currentWorkspace, VIEW_ONLY_MESSAGE } from "@/lib/workspace/current";

export type TaskResult = ActionResult<{ id: string }>;

function invalid(error: z.ZodError): TaskResult {
  return {
    ok: false,
    error: "Please fix the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<
      string,
      string[] | undefined
    >,
  };
}

const signedOut: TaskResult = { ok: false, error: "You are signed out." };
const notFound: TaskResult = { ok: false, error: "Task not found." };
const viewOnly: TaskResult = { ok: false, error: VIEW_ONLY_MESSAGE };

/** Maps Postgres errors to messages; never returns raw DB errors to the client. */
function dbError(
  code: string | undefined,
  userId: string,
  event: string,
): TaskResult {
  if (code === "42501") return viewOnly;
  if (code === "23503") {
    // Includes a project from another workspace (composite FK, step 3.2).
    return {
      ok: false,
      error: "Project not found in this workspace.",
      fieldErrors: { projectId: ["Project not found"] },
    };
  }
  if (code === "23505") {
    return {
      ok: false,
      error: "This repeating task already has an occurrence at that time.",
    };
  }
  log.warn(event, { userId, code });
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** The user-scoped client, the user, and their profile time zone (read from the DB, never the client). */
async function getContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, tz: null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();
  return { supabase, user, tz: profile?.timezone ?? "America/Los_Angeles" };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

function formFields(formData: FormData) {
  const get = (k: string) => formData.get(k) ?? "";
  return {
    title: get("title"),
    notes: get("notes"),
    status: formData.get("status") ?? "todo",
    priority: formData.get("priority") ?? "normal",
    projectId: get("projectId"),
    dueDate: get("dueDate"),
    dueTime: get("dueTime"),
    repeat: formData.get("repeat") ?? "none",
    weekday: get("weekday"),
    interval: get("interval"),
    monthDay: get("monthDay"),
    nth: get("nth"),
  };
}

function revalidate() {
  revalidatePath("/tasks");
  revalidatePath("/projects", "layout");
}

/**
 * Marks a task done; for a recurring task, complete_task() also inserts the
 * next occurrence (schedule-based, D-7) exactly once, even on double submit.
 */
async function complete(supabase: Supabase, taskId: string, now: Date) {
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, due_at, recurrence, recurrence_tz")
    .eq("id", taskId)
    .maybeSingle();
  if (error || !task) return { found: false as const, error };

  const next =
    task.recurrence && task.recurrence_tz && task.due_at
      ? nextOccurrence(
          task.recurrence,
          task.recurrence_tz,
          new Date(task.due_at),
          now,
        )
      : null;
  const { error: rpcError } = await supabase.rpc("complete_task", {
    p_task_id: taskId,
    p_next_due_at: next?.toISOString(),
  });
  return { found: true as const, error: rpcError };
}

export async function createTask(
  _prev: TaskResult | null,
  formData: FormData,
): Promise<TaskResult> {
  const parsed = taskFormSchema.safeParse(formFields(formData));
  if (!parsed.success) return invalid(parsed.error);

  const { supabase, user, tz } = await getContext();
  if (!user) return signedOut;

  const t = parsed.data;
  // A task goes where its project is (the project page may show a workspace
  // other than the current one); otherwise into the current workspace (D-23).
  let workspaceId: string;
  if (t.projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("workspace_id")
      .eq("id", t.projectId)
      .maybeSingle();
    if (!project) return dbError("23503", user.id, "task.create_failed");
    workspaceId = project.workspace_id;
  } else {
    workspaceId = (await currentWorkspace(supabase, user.id)).current.id;
  }
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      workspace_id: workspaceId,
      title: t.title,
      notes: t.notes,
      status: t.status === "done" ? "todo" : t.status,
      priority: t.priority,
      project_id: t.projectId,
      due_at: t.dueDate ? toUtc(t.dueDate, t.dueTime, tz).toISOString() : null,
      recurrence: t.recurrence,
      // The rule stays anchored to the zone it was created in (D-5).
      recurrence_tz: t.recurrence ? tz : null,
    })
    .select("id")
    .single();
  if (error) return dbError(error.code, user.id, "task.create_failed");

  log.info("task.created", {
    userId: user.id,
    taskId: data.id,
    recurring: !!t.recurrence,
  });
  revalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateTask(
  _prev: TaskResult | null,
  formData: FormData,
): Promise<TaskResult> {
  const id = taskIdSchema.safeParse(formData.get("id"));
  const parsed = taskFormSchema.safeParse(formFields(formData));
  if (!id.success) return notFound;
  if (!parsed.success) return invalid(parsed.error);

  const { supabase, user, tz } = await getContext();
  if (!user) return signedOut;

  const { data: existing } = await supabase
    .from("tasks")
    .select("status, recurrence_tz")
    .eq("id", id.data)
    .maybeSingle();
  if (!existing) return notFound;

  const t = parsed.data;
  const completing = t.status === "done" && existing.status !== "done";
  const { data, error } = await supabase
    .from("tasks")
    .update({
      title: t.title,
      notes: t.notes,
      // Completion goes through complete_task() below so recurrence is handled.
      status: completing ? existing.status : t.status,
      priority: t.priority,
      project_id: t.projectId,
      due_at: t.dueDate ? toUtc(t.dueDate, t.dueTime, tz).toISOString() : null,
      recurrence: t.recurrence,
      recurrence_tz: t.recurrence ? (existing.recurrence_tz ?? tz) : null,
    })
    .eq("id", id.data)
    .select("id");
  if (error) return dbError(error.code, user.id, "task.update_failed");
  // The task was visible above, so 0 rows means RLS refused the write.
  if (data.length === 0) return viewOnly;

  if (completing) {
    const done = await complete(supabase, id.data, new Date());
    if (done.error)
      return dbError(done.error.code, user.id, "task.complete_failed");
  }

  log.info("task.updated", { userId: user.id, taskId: id.data });
  revalidate();
  redirect("/tasks");
}

/** Checkbox form on each row. */
export async function completeTask(formData: FormData): Promise<void> {
  const id = taskIdSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase, user } = await getContext();
  if (!user) redirect("/login");

  const done = await complete(supabase, id.data, new Date());
  if (done.error)
    log.warn("task.complete_failed", {
      userId: user.id,
      code: done.error.code,
    });
  else if (done.found)
    log.info("task.completed", { userId: user.id, taskId: id.data });
  revalidate();
}

/** Reopening leaves any already-created next occurrence in place (D-7). */
export async function reopenTask(formData: FormData): Promise<void> {
  const id = taskIdSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase, user } = await getContext();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("tasks")
    .update({ status: "todo" })
    .eq("id", id.data);
  if (error)
    log.warn("task.reopen_failed", { userId: user.id, code: error.code });
  else log.info("task.reopened", { userId: user.id, taskId: id.data });
  revalidate();
}

export async function deleteTask(
  _prev: TaskResult | null,
  formData: FormData,
): Promise<TaskResult> {
  const id = taskIdSchema.safeParse(formData.get("id"));
  if (!id.success) return notFound;

  const { supabase, user } = await getContext();
  if (!user) return signedOut;

  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id.data)
    .select("id");
  if (error) return dbError(error.code, user.id, "task.delete_failed");
  if (data.length === 0) return notFound;

  log.info("task.deleted", { userId: user.id, taskId: id.data });
  revalidate();
  redirect("/tasks");
}
