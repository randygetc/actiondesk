"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type {
  CaptureEvent,
  SaveResult,
  UploadResult,
} from "@/app/(app)/capture/actions";
import type { ActionResult } from "@/lib/action-result";
import { fieldClass } from "@/components/tasks/types";
import { Button } from "@/components/ui/button";
import { MAX_MB, SIZE_ERROR } from "@/lib/attachments/detect";
import type { ExtractedTask, ReviewedTask } from "@/lib/validation/extraction";

// Everything here renders model output as plain text (trust boundary 2):
// React escapes it; nothing uses dangerouslySetInnerHTML.

const LOW_CONFIDENCE = 0.6;

type Row = ReviewedTask & {
  key: number;
  accepted: boolean;
  confidence: number;
};

function toRow(t: ExtractedTask, key: number): Row {
  const low = t.confidence < LOW_CONFIDENCE;
  return {
    key,
    title: t.title,
    assignee: t.assignee,
    dueDate: t.due_date,
    dueTime: t.due_time,
    projectId: t.project_id,
    sourceQuote: t.source_quote,
    confidence: t.confidence,
    // Low-confidence rows start unaccepted, so saving them is a choice.
    accepted: !low,
  };
}

const ACCEPT = ".pdf,.docx,.txt,.vtt,.srt";

export function CapturePanel({
  extract,
  extractFile,
  upload,
  discard,
  save,
  projects,
}: {
  extract: (input: {
    text: string;
    includeOthers: boolean;
  }) => Promise<AsyncGenerator<CaptureEvent>>;
  extractFile: (input: {
    attachmentId: string;
    includeOthers: boolean;
  }) => Promise<AsyncGenerator<CaptureEvent>>;
  upload: (formData: FormData) => Promise<UploadResult>;
  discard: (id: string) => Promise<ActionResult>;
  save: (rows: ReviewedTask[], attachmentId?: string) => Promise<SaveResult>;
  projects: { id: string; name: string }[];
}) {
  const [text, setText] = useState("");
  const [includeOthers, setIncludeOthers] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<
    "idle" | "extracting" | "reviewing" | "saving"
  >("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const nextKey = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  // The uploaded file behind the current review; deleted on save or discard (D-21).
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function clearFile() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function dropAttachment() {
    if (attachmentId) void discard(attachmentId);
    setAttachmentId(null);
  }

  async function onExtract() {
    setRows([]);
    setError(null);
    setNotice(null);
    setSaved(null);
    setStatus("extracting");
    dropAttachment();
    try {
      let events: AsyncGenerator<CaptureEvent>;
      if (file) {
        const form = new FormData();
        form.set("file", file);
        // A too-large body can fail before the action runs (platform limits).
        const uploaded = await upload(form).catch((): UploadResult => ({
          ok: false,
          error: `Couldn't upload the file. ${SIZE_ERROR}`,
        }));
        if (!uploaded.ok) {
          setError(uploaded.error);
          setStatus("idle");
          return;
        }
        setAttachmentId(uploaded.data.id);
        events = await extractFile({
          attachmentId: uploaded.data.id,
          includeOthers,
        });
      } else {
        events = await extract({ text, includeOthers });
      }
      for await (const e of events) {
        if (e.type === "task") {
          setRows((r) => [...r, toRow(e.task, nextKey.current++)]);
        } else if (e.type === "error") {
          setError(e.message);
        } else {
          const notes = [];
          if (e.refused) notes.push("The AI declined part of this note.");
          if (e.invalid > 0)
            notes.push(
              `${e.invalid} item${e.invalid === 1 ? "" : "s"} couldn't be read and ${e.invalid === 1 ? "was" : "were"} skipped.`,
            );
          if (notes.length) setNotice(notes.join(" "));
        }
      }
    } catch {
      setError("Couldn't extract tasks. Try again.");
    }
    setStatus("reviewing");
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((r) =>
      r.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  const accepted = rows.filter((r) => r.accepted);

  async function onSave() {
    setStatus("saving");
    setError(null);
    const result = await save(
      accepted.map(
        ({ title, assignee, dueDate, dueTime, projectId, sourceQuote }) => ({
          title,
          assignee,
          dueDate: dueDate || null,
          dueTime: dueDate && dueTime ? dueTime : null,
          projectId: projectId || null,
          sourceQuote,
        }),
      ),
      attachmentId ?? undefined,
    );
    if (result.ok) {
      setSaved(result.data.count);
      setRows([]);
      setText("");
      setAttachmentId(null);
      clearFile();
      setStatus("idle");
    } else {
      const bad = Object.entries(result.fieldErrors ?? {})
        .map(([i, errs]) => `“${accepted[Number(i)]?.title}”: ${errs?.[0]}`)
        .join(" ");
      setError(bad ? `${result.error} ${bad}` : result.error);
      setStatus("reviewing");
    }
  }

  function onDiscard() {
    dropAttachment();
    clearFile();
    setRows([]);
    setNotice(null);
    setStatus("idle");
  }

  const busy = status === "extracting" || status === "saving";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <label
          className="flex flex-col gap-1 text-sm font-medium"
          htmlFor="note"
        >
          Notes
        </label>
        <textarea
          id="note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          maxLength={20_000}
          className="rounded-md border bg-background p-3 text-sm"
          placeholder="Paste notes here…"
          disabled={file !== null}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="note-file" className="font-medium">
            Or upload a file
          </label>
          <input
            id="note-file"
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          {file ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFile}>
              Remove file
            </Button>
          ) : null}
          <span className="text-muted-foreground">
            PDF, Word, .txt, .vtt or .srt, up to {MAX_MB} MB. Deleted after
            review.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeOthers}
              onChange={(e) => setIncludeOthers(e.target.checked)}
            />
            Include other people&apos;s tasks
          </label>
          <Button
            type="button"
            onClick={onExtract}
            disabled={busy || (file === null && text.trim() === "")}
            className="ml-auto"
          >
            {status === "extracting" ? "Finding tasks…" : "Find tasks"}
          </Button>
        </div>
      </section>

      {saved !== null ? (
        <p role="status" className="text-sm">
          Saved {saved} task{saved === 1 ? "" : "s"}.{" "}
          <Link href="/tasks" className="underline">
            View tasks
          </Link>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm text-muted-foreground">{notice}</p>
      ) : null}

      {rows.length > 0 || status === "extracting" ? (
        <section className="flex flex-col gap-3" aria-label="Review">
          <h2 className="text-lg font-semibold">Review</h2>
          <ul className="flex flex-col gap-3" aria-label="Found tasks">
            {rows.map((row) => (
              <ReviewRow
                key={row.key}
                row={row}
                projects={projects}
                onChange={(patch) => update(row.key, patch)}
                onReject={() =>
                  setRows((r) => r.filter((x) => x.key !== row.key))
                }
              />
            ))}
          </ul>
          {status === "extracting" ? (
            <p className="text-sm text-muted-foreground">Still reading…</p>
          ) : rows.length === 0 ? null : (
            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={onSave}
                disabled={busy || accepted.length === 0}
              >
                {status === "saving"
                  ? "Saving…"
                  : `Save ${accepted.length} accepted`}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onDiscard}
                disabled={busy}
              >
                Discard
              </Button>
            </div>
          )}
        </section>
      ) : status === "reviewing" && !error ? (
        <p className="text-sm text-muted-foreground">No tasks found.</p>
      ) : null}
    </div>
  );
}

function ReviewRow({
  row,
  projects,
  onChange,
  onReject,
}: {
  row: Row;
  projects: { id: string; name: string }[];
  onChange: (patch: Partial<Row>) => void;
  onReject: () => void;
}) {
  const low = row.confidence < LOW_CONFIDENCE;
  const id = `row-${row.key}`;
  return (
    <li
      className={`flex flex-col gap-2 rounded-md border p-3 ${low ? "border-amber-500" : ""}`}
      aria-label={row.title || "Untitled task"}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          aria-label="Accept"
          checked={row.accepted}
          onChange={(e) => onChange({ accepted: e.target.checked })}
        />
        <input
          aria-label="Title"
          value={row.title}
          maxLength={200}
          onChange={(e) => onChange({ title: e.target.value })}
          className={`${fieldClass} min-w-48 flex-1`}
        />
        {low ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
            Low confidence: check this
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onReject}>
          Reject
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Assignee"
          value={row.assignee ?? ""}
          maxLength={200}
          onChange={(e) => onChange({ assignee: e.target.value })}
          className={`${fieldClass} w-32`}
        />
        <input
          type="date"
          aria-label="Due date"
          value={row.dueDate ?? ""}
          onChange={(e) => onChange({ dueDate: e.target.value || null })}
          className={fieldClass}
        />
        <input
          type="time"
          aria-label="Due time"
          value={row.dueTime ?? ""}
          onChange={(e) => onChange({ dueTime: e.target.value || null })}
          className={fieldClass}
        />
        <select
          aria-label="Project"
          value={row.projectId ?? ""}
          onChange={(e) => onChange({ projectId: e.target.value || null })}
          className={fieldClass}
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {row.sourceQuote ? (
        <p id={`${id}-quote`} className="text-xs text-muted-foreground">
          “{row.sourceQuote}”
        </p>
      ) : null}
    </li>
  );
}
