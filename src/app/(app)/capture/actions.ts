"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { llmClient } from "@/lib/llm";
import { isAbort, isApiError } from "@/lib/llm/client";
import { EXTRACT_PROMPT_VERSION, extractTasks } from "@/lib/llm/extract";
import { EXTRACT_MODEL } from "@/lib/llm/models";
import {
  CAP_MESSAGE,
  capReached,
  recordUsage,
  usageMeter,
} from "@/lib/llm/usage";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { toUtc } from "@/lib/time/zones";
import {
  captureInputSchema,
  parseReviewedTask,
  saveReviewedSchema,
  type ExtractedTask,
} from "@/lib/validation/extraction";

/** Streamed to the review screen. Never carries raw errors or model text. */
export type CaptureEvent =
  | { type: "task"; task: ExtractedTask }
  | { type: "done"; invalid: number; refused: boolean }
  | { type: "error"; message: string };

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
    // The model needs a name to tell the user's tasks from others' (D-13).
    userName:
      profile?.display_name?.trim() || user.email?.split("@")[0] || "the user",
    projects: projects ?? [],
  } as const;
}

async function* once(event: CaptureEvent): AsyncGenerator<CaptureEvent> {
  yield event;
}

/**
 * Extracts tasks from pasted notes and streams them to the review screen
 * (plan §3.1 pattern: authenticate and validate, then return a generator).
 * Nothing is saved here (D-14); every call is logged in `finally`, including
 * aborted ones.
 */
export async function extractFromText(input: {
  text: string;
  includeOthers: boolean;
}): Promise<AsyncGenerator<CaptureEvent>> {
  const parsed = captureInputSchema.safeParse(input);
  if (!parsed.success)
    return once({
      type: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    });

  const ctx = await getContext();
  if (!ctx.user) return once({ type: "error", message: "You are signed out." });

  return run(ctx, parsed.data);
}

async function* run(
  ctx: Exclude<Awaited<ReturnType<typeof getContext>>, { user: null }>,
  input: { text: string; includeOthers: boolean },
): AsyncGenerator<CaptureEvent> {
  const meter = usageMeter(EXTRACT_MODEL.model);
  const abort = new AbortController();
  let outcome: "ok" | "invalid_output" | "error" | "aborted" | "capped" =
    "aborted";
  let count = 0;

  try {
    // Daily cap (2.6), checked before any API call.
    if (await capReached(ctx.supabase, ctx.tz)) {
      outcome = "capped";
      yield { type: "error", message: CAP_MESSAGE };
      return;
    }
    for await (const e of extractTasks(
      llmClient(),
      {
        note: { kind: "text", text: input.text },
        now: new Date(),
        timezone: ctx.tz,
        userName: ctx.userName,
        projects: ctx.projects,
        includeOthers: input.includeOthers,
      },
      { onMessage: meter.add, signal: abort.signal },
    )) {
      if (e.type === "task") {
        count++;
        yield e;
      } else {
        outcome = e.invalid > 0 ? "invalid_output" : "ok";
        yield {
          type: "done",
          invalid: e.invalid,
          refused: e.stopReason === "refusal",
        };
      }
    }
  } catch (e) {
    if (isAbort(e)) {
      outcome = "aborted";
    } else {
      outcome = "error";
      log.error("capture.extract_failed", {
        userId: ctx.user.id,
        status: isApiError(e) ? (e.status ?? null) : null,
        kind: e instanceof Error ? e.name : "unknown",
      });
      yield {
        type: "error",
        message:
          isApiError(e) && e.status === 429
            ? "The AI service is busy. Try again in a minute."
            : "Couldn't extract tasks. Try again.",
      };
    }
  } finally {
    // Runs when the client disconnects too (spike result d, plan §3.1).
    abort.abort();
    await recordUsage(ctx.supabase, {
      userId: ctx.user.id,
      feature: "extract",
      outcome,
      meter,
      promptVersion: EXTRACT_PROMPT_VERSION,
    });
    log.info("capture.extracted", { userId: ctx.user.id, count, outcome });
  }
}

export type SaveResult = ActionResult<{ count: number }>;

/**
 * Saves the rows the user accepted. Each is re-validated with the manual task
 * form's schema (trust boundary 3); owner_id comes from the session.
 */
export async function saveReviewedTasks(rows: unknown): Promise<SaveResult> {
  const parsed = saveReviewedSchema.safeParse(rows);
  if (!parsed.success) return { ok: false, error: "Nothing valid to save." };

  const fieldErrors: Record<string, string[]> = {};
  const tasks = parsed.data.flatMap((row, i) => {
    const t = parseReviewedTask(row);
    if (!t.success) {
      fieldErrors[String(i)] = t.error.issues.map((x) => x.message);
      return [];
    }
    return [{ task: t.data, row }];
  });
  if (Object.keys(fieldErrors).length > 0)
    return { ok: false, error: "Some rows need fixing.", fieldErrors };

  const ctx = await getContext();
  if (!ctx.user) return { ok: false, error: "You are signed out." };

  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert(
      tasks.map(({ task, row }) => ({
        title: task.title,
        project_id: task.projectId,
        due_at: task.dueDate
          ? toUtc(task.dueDate, task.dueTime, ctx.tz).toISOString()
          : null,
        source: "extraction" as const,
        source_quote: row.sourceQuote || null,
        assignee_text: row.assignee || null,
      })),
    )
    .select("id");
  if (error) {
    log.error("capture.save_failed", { userId: ctx.user.id, code: error.code });
    return {
      ok: false,
      error:
        error.code === "23503"
          ? "A project no longer exists. Pick another and try again."
          : "Couldn't save the tasks. Try again.",
    };
  }

  log.info("capture.saved", { userId: ctx.user.id, count: data.length });
  revalidatePath("/tasks");
  return { ok: true, data: { count: data.length } };
}
