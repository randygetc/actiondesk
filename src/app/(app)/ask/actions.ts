"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { llmClient } from "@/lib/llm";
import { ask, type AskEvent } from "@/lib/llm/ask";
import { isAbort, isApiError } from "@/lib/llm/client";
import { ASK_MODEL } from "@/lib/llm/models";
import { ASK_PROMPT_VERSION } from "@/lib/llm/prompts/ask";
import { CAP_MESSAGE, capReached } from "@/lib/llm/usage";
import { usageRun, type UsageRun } from "@/lib/llm/usage-run";
import { log } from "@/lib/log";
import { requestLog } from "@/lib/request-log";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspace, VIEW_ONLY_MESSAGE } from "@/lib/workspace/current";
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
  // Ask answers about the current workspace (D-23).
  const { current: workspace } = await currentWorkspace(supabase, user.id);
  const [{ data: profile }, { data: projects }] = await Promise.all([
    supabase
      .from("profiles")
      .select("timezone, display_name")
      .eq("id", user.id)
      .single(),
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", workspace.id)
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
    workspace,
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
  return run(
    ctx,
    parsed.data,
    usageRun({
      supabase: ctx.supabase,
      userId: ctx.user.id,
      feature: "ask",
      model: ASK_MODEL.model,
      promptVersion: ASK_PROMPT_VERSION,
      workspaceId: ctx.workspace.id,
    }),
  );
}

async function* run(
  ctx: Ctx,
  input: {
    history: { role: "user" | "assistant"; text: string }[];
    question: string;
  },
  usage: UsageRun,
): AsyncGenerator<AskStreamEvent> {
  let outcome: Parameters<UsageRun["setOutcome"]>[0] = "aborted";
  const set = (o: typeof outcome) => {
    outcome = o;
    usage.setOutcome(o);
  };
  let toolCalls = 0;

  try {
    // Daily cap (2.6), checked before any API call.
    if (await capReached(ctx.supabase)) {
      set("capped");
      yield { type: "error", message: CAP_MESSAGE };
      return;
    }
    for await (const e of ask(
      llmClient(),
      {
        supabase: ctx.supabase,
        workspaceId: ctx.workspace.id,
        now: new Date(),
        timezone: ctx.tz,
        userName: ctx.userName,
        projects: ctx.projects,
      },
      input,
      {
        onMessage: usage.meter.add,
        onUsage: usage.meter.partial,
        signal: usage.signal,
        onToolError: (tool, e) =>
          log.error("ask.tool_failed", {
            userId: ctx.user.id,
            tool,
            // Name only: a message could carry data (rule 12, review #8).
            kind: e instanceof Error ? e.name : "unknown",
          }),
      },
    )) {
      if (e.type === "tool_call") toolCalls++;
      if (e.type === "done") set("ok");
      yield e;
    }
  } catch (e) {
    if (isAbort(e)) {
      set("aborted");
    } else {
      set("error");
      (await requestLog()).error("ask.failed", {
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
    // If the client disconnected, after() in usageRun records instead.
    await usage.finish();
    (await requestLog()).info("ask.answered", {
      userId: ctx.user.id,
      toolCalls,
      outcome,
    });
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
      workspace_id: p.data.workspaceId,
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
    (await requestLog()).error("ask.confirm_failed", {
      userId: ctx.user.id,
      code: error.code,
    });
    return {
      ok: false,
      error:
        error.code === "42501"
          ? VIEW_ONLY_MESSAGE
          : error.code === "23503"
            ? "That project no longer exists."
            : "Couldn't create the task. Try again.",
    };
  }

  (await requestLog()).info("ask.task_created", {
    userId: ctx.user.id,
    taskId: data.id,
  });
  revalidatePath("/tasks");
  return { ok: true, data: { id: data.id } };
}
