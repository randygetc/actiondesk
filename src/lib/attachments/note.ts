import "server-only";

import mammoth from "mammoth";

import type { ExtractInput } from "@/lib/llm/extract";

import { decodeText, detectFile } from "./detect";
import { transcriptToText } from "./transcript";

/** Longest text sent for extraction from a file (about 12k tokens). */
export const FILE_TEXT_MAX = 50_000;

export type NoteResult =
  { ok: true; note: ExtractInput["note"] } | { ok: false; error: string };

/**
 * Turns an uploaded file into the note extraction reads. PDFs go to the model
 * as a document; everything else becomes text. Hidden text (white, tiny) is
 * still just note content, which the prompt treats as data (plan §3.8).
 */
export async function fileToNote(bytes: Uint8Array): Promise<NoteResult> {
  const detected = detectFile(bytes);
  if (!detected.ok) return detected;

  if (detected.kind === "pdf")
    return {
      ok: true,
      note: { kind: "pdf", base64: Buffer.from(bytes).toString("base64") },
    };

  let text: string;
  if (detected.kind === "docx") {
    try {
      // Raw text only: no HTML is produced or rendered.
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) }))
        .value;
    } catch {
      return { ok: false, error: "Couldn't read that Word document." };
    }
  } else {
    const raw = decodeText(bytes) ?? "";
    text = detected.kind === "txt" ? raw : transcriptToText(raw);
  }

  text = text.trim();
  if (!text) return { ok: false, error: "The file has no text to read." };
  if (text.length > FILE_TEXT_MAX)
    return {
      ok: false,
      error: "That file is too long. Split it into smaller notes.",
    };
  return { ok: true, note: { kind: "text", text } };
}
