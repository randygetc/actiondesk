// File type from the bytes, never from the name or the browser's MIME type
// (trust boundary 11, plan §3.6). Pure, so it runs in unit tests.

import { checkDocx } from "./zip";

/**
 * 4 MB so an upload fits Vercel's 4.5 MB function request body (R-22, owner
 * decision D-22: Option B of the proposed ADR 0007, which was not adopted).
 */
export const MAX_MB = 4;
export const MAX_BYTES = MAX_MB * 1024 * 1024;
export const SIZE_ERROR = `Files can be at most ${MAX_MB} MB.`;

export type FileKind = "pdf" | "docx" | "txt" | "vtt" | "srt";

export const MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  vtt: "text/vtt",
  srt: "text/plain",
};

export type Detected =
  { ok: true; kind: FileKind } | { ok: false; error: string };

const startsWith = (b: Uint8Array, sig: number[]) =>
  sig.every((byte, i) => b[i] === byte);

/** Strict UTF-8 text with no NUL bytes, or null. */
export function decodeText(b: Uint8Array): string | null {
  if (b.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(b)
      .replace(/^﻿/, "");
  } catch {
    return null;
  }
}

export function detectFile(b: Uint8Array): Detected {
  if (b.length === 0) return { ok: false, error: "The file is empty." };
  if (b.length > MAX_BYTES)
    return { ok: false, error: SIZE_ERROR };

  // %PDF-
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { ok: true, kind: "pdf" };
  // A zip (PK\x03\x04): must be a Word document whose parts stay within
  // size limits when inflated (zip bombs, security review #5).
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    const docx = checkDocx(b);
    return docx.ok ? { ok: true, kind: "docx" } : docx;
  }

  const text = decodeText(b);
  if (text === null)
    return {
      ok: false,
      error:
        "Unsupported file. Use a PDF, Word (.docx), text, or .vtt/.srt transcript.",
    };
  if (/^WEBVTT(?:[ \t].*)?\r?$/m.test(text.split("\n", 1)[0]))
    return { ok: true, kind: "vtt" };
  if (/^\s*\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} --> /.test(text))
    return { ok: true, kind: "srt" };
  return { ok: true, kind: "txt" };
}
