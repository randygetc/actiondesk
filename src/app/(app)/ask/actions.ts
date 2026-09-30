"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { llmClient } from "@/lib/llm";
import { ask, type AskEvent } from "@/lib/llm/ask";
import { isAbort, isApiError } from "@/lib/llm/client";
import { ASK_MODEL } from "@/lib/llm/models";
import { ASK_PROMPT_VERSION } from "@/lib/llm/prompts/ask";
import { recordUsage, usageMeter } from "@/lib/llm/usage";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { toUtc } from "@/lib/time/zones";
import { askInputSchema, createTaskProposalSchema } from "@/lib/validation/ask";
import { taskFormSchema } from "@/lib/validation/task";

/** Streamed to the Ask panel. Never carries raw errors. */
export type AskStreamEvent = AskEvent | { type: "error"; message: string };

async function getContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null } as const;
  const [{ data: profile }, { data: projects }] = await Promise.all([
    supabase
      .from("profiles")
      .select("timezone, display_name")
      .eq("id", user.id)
      .single(),
    supabase
      .from("projects")
      .select("id, name")
      .is("archived_at", null)
      .order("name"),
  ]);
  return {
    supabase,
    user,
    tz: profile?.timezone ?? "America/Los_Angeles",
    userName:
      profile?.display_name?.trim() || user.email?.split("@")[0] || "the user",
    projects: projects ?? [],
  } as const;
}

type Ctx = Exclude<Awaited<ReturnType<typeof getContext>>, { user: null }>;

async function* once(event: AskStreamEvent): AsyncGenerator<AskStreamEvent> {
  yield event;
}

/**
 * Answers a question with the tool loop. Tools get this request's user-scoped
 * client (ADR-0003); history is text only (trust boundary 8). Usage is logged
 * in `finally`, including aborted calls.
 */
export async function askStream(
  input: unknown,
): Promise<AsyncGenerator<AskStreamEvent>> {
  const parsed = askInputSchema.safeParse(input);
  if (!parsed.success)
    return once({
      type: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid question.",
    });

  const ctx = await getContext();
  if (!ctx.user) return once({ type: "error", message: "You are signed out." });
  return run(ctx, parsed.data);
}

async function* run(
  ctx: Ctx,
  input: {
    history: { role: "user" | "assistant"; text: string }[];
    question: string;
  },
): AsyncGenerator<AskStreamEvent> {
  const meter = usageMeter(ASK_MODEL.model);
  const abort = new AbortController();
  let outcome: "ok" | "error" | "aborted" = "aborted";
  let toolCalls = 0;

  try {
    for await (const e of ask(
      llmClient(),
      {
        supabase: ctx.supabase,
        now: new Date(),
        timezone: ctx.tz,
        userName: ctx.userName,
        projects: ctx.projects,
      },
      input,
      {
        onMessage: meter.add,
        signal: abort.signal,
        onToolError: (tool, e) =>
          log.error("ask.tool_failed", {
            userId: ctx.user.id,
            tool,
            kind: e instanceof Error ? e.message : "unknown",
          }),
      },
    )) {
      if (e.type === "tool_call") toolCalls++;
      if (e.type === "done") outcome = "ok";
      yield e;
    }
  } catch (e) {
    if (isAbort(e)) {
      outcome = "aborted";
    } else {
      outcome = "error";
      log.error("ask.failed", {
        userId: ctx.user.id,
        status: isApiError(e) ? (e.status ?? null) : null,
        kind: e instanceof Error ? e.name : "unknown",
      });
      yield {
        type: "error",
        message:
          isApiError(e) && e.status === 429
            ? "The AI service is busy. Try again in a minute."
            : "Something went wrong. Try again.",
      };
    }
  } finally {
    abort.abort();
    await recordUsage(ctx.supabase, {
      userId: ctx.user.id,
      feature: "ask",
      outcome,
      meter,
      promptVersion: ASK_PROMPT_VERSION,
    });
    log.info("ask.answered", { userId: ctx.user.id, toolCalls, outcome });
  }
}

export type ConfirmResult = ActionResult<{ id: string }>;

/**
 * Creates a task the assistant proposed, after the user's click. The proposal
 * came back from the browser, so it's validated like manual input (trust
 * boundaries 5 and 9); owner_id comes from the session.
 */
export async function confirmCreateTask(
  proposal: unknown,
): Promise<ConfirmResult> {
  const p = createTaskProposalSchema.safeParse(proposal);
  if (!p.success) return { ok: false, error: "That proposal isn't valid." };

  const t = taskFormSchema.safeParse({
    title: p.data.title,
    status: "todo",
    priority: p.data.priority,
    projectId: p.data.projectId ?? "",
    dueDate: p.data.dueDate ?? "",
    dueTime: p.data.dueTime ?? "",
    repeat: "none",
  });
  if (!t.success)
    return { ok: false, error: t.error.issues[0]?.message ?? "Invalid task." };

  const ctx = await getContext();
  if (!ctx.user) return { ok: false, error: "You are signed out." };

  const task = t.data;
  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert({
      title: task.title,
      priority: task.priority,
      project_id: task.projectId,
      due_at: task.dueDate
        ? toUtc(task.dueDate, task.dueTime, ctx.tz).toISOString()
        : null,
      source: "ask",
    })
    .select("id")
    .single();
  if (error) {
    log.error("ask.confirm_failed", { userId: ctx.user.id, code: error.code });
    return {
      ok: false,
      error:
        error.code === "23503"
          ? "That project no longer exists."
          : "Couldn't create the task. Try again.",
    };
  }

  log.info("ask.task_created", { userId: ctx.user.id, taskId: data.id });
  revalidatePath("/tasks");
  return { ok: true, data: { id: data.id } };
}
