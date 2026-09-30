// Extraction eval (plan §3.7).
//   npm run eval                  replays recorded.json (no key, deterministic)
//   EVAL_LIVE=1 npm run eval      calls the API and rewrites recorded.json
// EVAL_MODEL=<id> runs another model (step 2.4), with its own recordings in
// recorded.<id>.json, so CI keeps scoring the production model's recorded.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  anthropicClient,
  recordingClient,
  replayClient,
  type LlmMessage,
} from "@/lib/llm/client";
import { extractTasks, type ExtractInput } from "@/lib/llm/extract";
import { EXTRACT_MODEL, type ModelConfig } from "@/lib/llm/models";
import { costUsd } from "@/lib/llm/pricing";

import { loadCases } from "./lib/cases";
import { formatReport, runEval, type Extractor } from "./lib/run";
import type { EvalCase, ScoredTask } from "./lib/schema";

const root = fileURLToPath(new URL("./extraction", import.meta.url));
const live = !!process.env.EVAL_LIVE;

function config(): ModelConfig {
  const model = process.env.EVAL_MODEL;
  if (!model) return EXTRACT_MODEL;
  const haiku = model.startsWith("claude-haiku");
  return {
    ...EXTRACT_MODEL,
    model,
    // Haiku 4.5 rejects effort and has no adaptive thinking (claude-api docs);
    // the server-side fallback is documented for the 5.x models only.
    effort: haiku ? undefined : EXTRACT_MODEL.effort,
    fallbacks: haiku ? false : EXTRACT_MODEL.fallbacks,
  };
}

function toInput(c: EvalCase): ExtractInput {
  return {
    note:
      c.input.kind === "text"
        ? { kind: "text", text: c.input.text }
        : {
            kind: "pdf",
            base64: readFileSync(c.input.path).toString("base64"),
          },
    now: new Date(c.context.now),
    timezone: c.context.timezone,
    userName: c.context.userName,
    projects: c.context.projects,
    includeOthers: c.context.includeOthers,
  };
}

type CaseStats = {
  name: string;
  cost: number;
  ms: number | null;
  calls: number;
};
const stats: CaseStats[] = [];

const extractor: Extractor = async (c) => {
  const model = process.env.EVAL_MODEL;
  const file = join(c.dir, model ? `recorded.${model}.json` : "recorded.json");
  let messages: LlmMessage[] = [];
  let client;
  if (live) {
    const rec = recordingClient(anthropicClient);
    client = rec.client;
    messages = rec.recorded;
  } else {
    if (!existsSync(file)) return null;
    messages = JSON.parse(readFileSync(file, "utf8")) as LlmMessage[];
    client = replayClient(messages);
  }

  const started = performance.now();
  const tasks: ScoredTask[] = [];
  try {
    for await (const e of extractTasks(client, toInput(c), {
      config: config(),
    })) {
      if (e.type !== "task") continue;
      const { title, assignee, due_date, due_time, project_id } = e.task;
      tasks.push({ title, assignee, due_date, due_time, project_id });
    }
  } finally {
    if (live) writeFileSync(file, JSON.stringify(messages, null, 2) + "\n");
    stats.push({
      name: c.name,
      cost: messages.reduce((s, m) => s + costUsd(m.model, m.usage), 0),
      ms: live ? Math.round(performance.now() - started) : null,
      calls: messages.length,
    });
  }
  return tasks;
};

function statsReport(): string {
  if (stats.length === 0) return "";
  const cost = stats.reduce((s, x) => s + x.cost, 0);
  const calls = stats.reduce((s, x) => s + x.calls, 0);
  const ms = stats
    .flatMap((x) => (x.ms === null ? [] : [x.ms]))
    .sort((a, b) => a - b);
  const p50 = ms.length
    ? `, p50 latency ${ms[Math.floor(ms.length / 2)]} ms`
    : "";
  return (
    `${live ? `live (${config().model})` : "recorded"}: ` +
    `${calls} API calls, $${cost.toFixed(4)} total, ` +
    `$${(cost / stats.length).toFixed(4)} per case${p50}`
  );
}

it("extraction", { timeout: 30 * 60_000 }, async () => {
  const result = await runEval(loadCases(root), extractor);
  console.log(`\n${formatReport(result)}\n${statsReport()}\n`);

  expect(result.cases.filter((c) => c.status === "error")).toEqual([]);
});
