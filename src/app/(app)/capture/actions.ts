"use server";

import { revalidatePath } from "next/cache";

import { randomUUID } from "node:crypto";

import type { ActionResult } from "@/lib/action-result";
import {
  detectFile,
  MIME,
  type FileKind,
} from "@/lib/attachments/detect";
import { fileToNote } from "@/lib/attachments/note";
import { llmClient } from "@/lib/llm";
import { isAbort, isApiError } from "@/lib/llm/client";
import {
  EXTRACT_PROMPT_VERSION,
  extractTasks,
  NoteTooLargeError,
  type ExtractInput,
} from "@/lib/llm/extract";
import { EXTRACT_MODEL } from "@/lib/llm/models";
import { CAP_MESSAGE, capReached } from "@/lib/llm/usage";
import { usageRun, type UsageRun } from "@/lib/llm/usage-run";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { toUtc } from "@/lib/time/zones";
import {
  attachmentIdSchema,
  captureInputSchema,
  extractAttachmentSchema,
  parseReviewedTask,
  saveReviewedSchema,
  uploadFileSchema,
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

  return run(
    ctx,
    { kind: "text", text: parsed.data.text },
    parsed.data.includeOthers,
    extractUsage(ctx),
  );
}

type Ctx = Exclude<Awaited<ReturnType<typeof getContext>>, { user: null }>;

/** Created in the action, so after() is registered for this request. */
const extractUsage = (ctx: Ctx) =>
  usageRun({
    supabase: ctx.supabase,
    userId: ctx.user.id,
    feature: "extract",
    model: EXTRACT_MODEL.model,
    promptVersion: EXTRACT_PROMPT_VERSION,
  });

async function* run(
  ctx: Ctx,
  note: ExtractInput["note"],
  includeOthers: boolean,
  usage: UsageRun,
): AsyncGenerator<CaptureEvent> {
  let outcome: Parameters<UsageRun["setOutcome"]>[0] = "aborted";
  const set = (o: typeof outcome) => {
    outcome = o;
    usage.setOutcome(o);
  };
  let count = 0;

  try {
    // Daily cap (2.6), checked before any API call.
    if (await capReached(ctx.supabase)) {
      set("capped");
      yield { type: "error", message: CAP_MESSAGE };
      return;
    }
    for await (const e of extractTasks(
      llmClient(),
      {
        note,
        now: new Date(),
        timezone: ctx.tz,
        userName: ctx.userName,
        projects: ctx.projects,
        includeOthers,
      },
      {
        onMessage: usage.meter.add,
        onUsage: usage.meter.partial,
        signal: usage.signal,
      },
    )) {
      if (e.type === "task") {
        count++;
        yield e;
      } else {
        set(e.invalid > 0 ? "invalid_output" : "ok");
        yield {
          type: "done",
          invalid: e.invalid,
          refused: e.stopReason === "refusal",
        };
      }
    }
  } catch (e) {
    if (isAbort(e)) {
      set("aborted");
    } else if (e instanceof NoteTooLargeError) {
      set("error");
      log.info("capture.note_too_large", {
        userId: ctx.user.id,
        tokens: e.tokens,
      });
      yield {
        type: "error",
        message:
          "That file is too long to read in one go (about 15 pages at most). Split it and try again.",
      };
    } else {
      set("error");
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
    // If the client disconnected, after() in usageRun records instead.
    await usage.finish();
    log.info("capture.extracted", { userId: ctx.user.id, count, outcome });
  }
}

export type SaveResult = ActionResult<{ count: number }>;

/**
 * Saves the rows the user accepted. Each is re-validated with the manual task
 * form's schema (trust boundary 3); owner_id comes from the session.
 */
export async function saveReviewedTasks(
  rows: unknown,
  attachmentId?: unknown,
): Promise<SaveResult> {
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

  // The file has served its purpose once tasks are saved (D-21).
  const attachment = attachmentIdSchema.safeParse(attachmentId);
  if (attachment.success) await deleteAttachment(ctx, attachment.data);

  log.info("capture.saved", { userId: ctx.user.id, count: data.length });
  revalidatePath("/tasks");
  return { ok: true, data: { count: data.length } };
}

const BUCKET = "attachments";

export type UploadResult = ActionResult<{ id: string; kind: FileKind }>;

/**
 * Stores an uploaded file for extraction (plan §3.6). Size and type are
 * checked here from the bytes; the file name and browser MIME type are
 * ignored, and the storage path is built on the server (trust boundary 11).
 */
export async function uploadAttachment(
  formData: FormData,
): Promise<UploadResult> {
  const parsed = uploadFileSchema.safeParse(formData.get("file"));
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Choose a file first.",
    };
  const file = parsed.data;

  const ctx = await getContext();
  if (!ctx.user) return { ok: false, error: "You are signed out." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectFile(bytes);
  if (!detected.ok) return detected;

  const id = randomUUID();
  const path = `${ctx.user.id}/${id}.${detected.kind}`;
  const mime = MIME[detected.kind];

  const { error: rowError } = await ctx.supabase.from("attachments").insert({
    id,
    storage_path: path,
    mime_type: mime,
    size_bytes: bytes.length,
  });
  if (rowError) {
    log.error("capture.attachment_row_failed", {
      userId: ctx.user.id,
      code: rowError.code,
    });
    return { ok: false, error: "Couldn't upload the file. Try again." };
  }

  const { error: uploadError } = await ctx.supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (uploadError) {
    await ctx.supabase.from("attachments").delete().eq("id", id);
    log.error("capture.attachment_upload_failed", { userId: ctx.user.id });
    return { ok: false, error: "Couldn't upload the file. Try again." };
  }

  log.info("capture.attachment_uploaded", {
    userId: ctx.user.id,
    attachmentId: id,
    kind: detected.kind,
    sizeBytes: bytes.length,
  });
  return { ok: true, data: { id, kind: detected.kind } };
}

/** Extracts tasks from an uploaded file, streaming like extractFromText. */
export async function extractFromAttachment(
  input: unknown,
): Promise<AsyncGenerator<CaptureEvent>> {
  const parsed = extractAttachmentSchema.safeParse(input);
  if (!parsed.success)
    return once({ type: "error", message: "Upload a file first." });

  const ctx = await getContext();
  if (!ctx.user) return once({ type: "error", message: "You are signed out." });

  // RLS: another user's attachment id finds nothing.
  const { data: row } = await ctx.supabase
    .from("attachments")
    .select("storage_path")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (!row)
    return once({
      type: "error",
      message: "That file is no longer available.",
    });

  const { data: blob, error } = await ctx.supabase.storage
    .from(BUCKET)
    .download(row.storage_path);
  if (error || !blob) {
    log.error("capture.attachment_download_failed", { userId: ctx.user.id });
    return once({
      type: "error",
      message: "Couldn't read the file. Try again.",
    });
  }

  // Re-checked from the stored bytes, not trusted from the upload step.
  const note = await fileToNote(new Uint8Array(await blob.arrayBuffer()));
  if (!note.ok) return once({ type: "error", message: note.error });

  return run(ctx, note.note, parsed.data.includeOthers, extractUsage(ctx));
}

/** Deletes an uploaded file when the review is discarded (D-21). */
export async function discardAttachment(id: unknown): Promise<ActionResult> {
  const parsed = attachmentIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Nothing to discard." };
  const ctx = await getContext();
  if (!ctx.user) return { ok: false, error: "You are signed out." };
  await deleteAttachment(ctx, parsed.data);
  return { ok: true, data: undefined };
}

/** Object first, then the row; a leftover row is cleaned up by R-20's job. */
async function deleteAttachment(ctx: Ctx, id: string): Promise<void> {
  const { data: row } = await ctx.supabase
    .from("attachments")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!row) return;
  const { error } = await ctx.supabase.storage
    .from(BUCKET)
    .remove([row.storage_path]);
  if (error) {
    log.error("capture.attachment_delete_failed", {
      userId: ctx.user.id,
      attachmentId: id,
    });
    return;
  }
  await ctx.supabase.from("attachments").delete().eq("id", id);
  log.info("capture.attachment_deleted", {
    userId: ctx.user.id,
    attachmentId: id,
  });
}
