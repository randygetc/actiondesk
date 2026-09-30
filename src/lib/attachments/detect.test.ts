import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { detectFile, MAX_BYTES } from "./detect";

const bytes = (s: string) => new TextEncoder().encode(s);
const docx = new Uint8Array(
  readFileSync(new URL("./fixtures/sample.docx", import.meta.url)),
);

describe("detectFile", () => {
  it.each([
    ["a PDF", bytes("%PDF-1.4\n..."), "pdf"],
    ["a Word document", docx, "docx"],
    ["plain text", bytes("Standup\n- send the deck"), "txt"],
    ["text with a BOM", bytes("﻿hello"), "txt"],
    [
      "a WebVTT transcript",
      bytes("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi"),
      "vtt",
    ],
    [
      "an SRT transcript",
      bytes("1\n00:00:01,000 --> 00:00:02,000\nHi\n"),
      "srt",
    ],
  ])("recognizes %s by its bytes", (_, b, kind) => {
    expect(detectFile(b)).toEqual({ ok: true, kind });
  });

  it("ignores the file name: an .exe renamed .pdf is rejected", () => {
    const exe = new Uint8Array([
      0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
    ]);
    expect(detectFile(exe)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Unsupported/),
    });
  });

  it("rejects a zip that isn't a Word document", () => {
    const zip = new Uint8Array([
      0x50,
      0x4b,
      0x03,
      0x04,
      ...bytes("other/file.txt"),
    ]);
    expect(detectFile(zip)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/readable Word document/),
    });
  });

  it("rejects a .docx zip bomb before anything is inflated (review #5)", () => {
    // 30 MB of word/document.xml, about 30 KB compressed.
    const bomb = new Uint8Array(
      readFileSync(new URL("./fixtures/bomb.docx", import.meta.url)),
    );
    expect(bomb.length).toBeLessThan(100_000);
    expect(detectFile(bomb)).toEqual({
      ok: false,
      error: "That Word document is too large to read.",
    });
  });

  it("rejects binary data and invalid UTF-8", () => {
    expect(detectFile(new Uint8Array([0x68, 0x00, 0x69]))).toMatchObject({
      ok: false,
    });
    expect(detectFile(new Uint8Array([0xff, 0xfe, 0xfd]))).toMatchObject({
      ok: false,
    });
  });

  it("rejects empty and oversized files", () => {
    expect(detectFile(new Uint8Array())).toEqual({
      ok: false,
      error: "The file is empty.",
    });
    expect(detectFile(new Uint8Array(MAX_BYTES + 1))).toEqual({
      ok: false,
      error: "Files can be at most 4 MB.",
    });
  });
});
