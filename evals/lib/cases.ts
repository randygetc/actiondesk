import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { caseSchema, expectedSchema, type EvalCase } from "./schema";

const FILE_INPUTS = ["input.pdf", "input.docx", "input.vtt", "input.srt"];

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Loads every case folder in `root`, skipping names that start with `_`. */
export function loadCases(root: string): EvalCase[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort()
    .map((name) => loadCase(join(root, name), name));
}

export function loadCase(dir: string, name: string): EvalCase {
  const where = (file: string) => `${name}/${file}`;

  const context = caseSchema.safeParse(readJson(join(dir, "case.json")));
  if (!context.success)
    throw new Error(`${where("case.json")}: ${issues(context.error)}`);

  const expected = expectedSchema.safeParse(
    readJson(join(dir, "expected.json")),
  );
  if (!expected.success)
    throw new Error(`${where("expected.json")}: ${issues(expected.error)}`);

  const ids = new Set(context.data.projects.map((p) => p.id));
  for (const t of expected.data)
    if (t.project_id && !ids.has(t.project_id))
      throw new Error(`${where("expected.json")}: unknown project_id`);

  const txt = join(dir, "input.txt");
  const file = FILE_INPUTS.map((f) => join(dir, f)).find((f) => existsSync(f));
  const input = existsSync(txt)
    ? { kind: "text" as const, text: readFileSync(txt, "utf8") }
    : file
      ? { kind: "file" as const, path: file }
      : null;
  if (!input)
    throw new Error(
      `${name}: needs input.txt or one of ${FILE_INPUTS.join(", ")}`,
    );

  return { name, dir, context: context.data, input, expected: expected.data };
}

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
