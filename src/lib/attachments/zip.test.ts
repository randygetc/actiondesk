import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkDocx, zipEntries } from "./zip";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("zipEntries", () => {
  it("lists names and uncompressed sizes without inflating", () => {
    const entries = zipEntries(fixture("bomb.docx"));
    expect(
      entries?.find((e) => e.name === "word/document.xml")?.size,
    ).toBeGreaterThan(30 * 1024 * 1024);
  });

  it("returns null for bytes that aren't a zip", () => {
    expect(
      zipEntries(new TextEncoder().encode("PK\x03\x04 not really")),
    ).toBeNull();
  });
});

describe("checkDocx", () => {
  it("accepts a normal Word document", () => {
    expect(checkDocx(fixture("sample.docx"))).toEqual({ ok: true });
  });

  it("rejects a document part that inflates past the limit", () => {
    expect(checkDocx(fixture("bomb.docx"))).toMatchObject({ ok: false });
  });
});
