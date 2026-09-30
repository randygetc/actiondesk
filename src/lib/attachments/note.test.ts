import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FILE_TEXT_MAX, fileToNote } from "./note";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("fileToNote", () => {
  it("sends a PDF as a document", async () => {
    const r = await fileToNote(bytes("%PDF-1.4\nx"));
    expect(r).toMatchObject({ ok: true, note: { kind: "pdf" } });
  });

  it("reads a Word document's text", async () => {
    const docx = new Uint8Array(
      readFileSync(new URL("./fixtures/sample.docx", import.meta.url)),
    );
    const r = await fileToNote(docx);
    expect(r).toEqual({
      ok: true,
      note: {
        kind: "text",
        text: "Planning notes\n\nRandy: draft the budget by Friday.",
      },
    });
  });

  it("flattens a transcript", async () => {
    const r = await fileToNote(
      bytes("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Ana>Hi</v>\n"),
    );
    expect(r).toEqual({ ok: true, note: { kind: "text", text: "Ana: Hi" } });
  });

  it("rejects a file with no text or too much text", async () => {
    expect(await fileToNote(bytes("   \n  "))).toMatchObject({ ok: false });
    expect(
      await fileToNote(bytes("x".repeat(FILE_TEXT_MAX + 1))),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/too long/),
    });
  });

  it("rejects a corrupt Word document", async () => {
    const fake = new Uint8Array([
      0x50,
      0x4b,
      0x03,
      0x04,
      ...bytes("word/document.xml garbage"),
    ]);
    expect(await fileToNote(fake)).toEqual({
      ok: false,
      error: "Couldn't read that Word document.",
    });
  });
});
