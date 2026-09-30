import "server-only";

import { randomBytes } from "node:crypto";

import { calendar, toLocalParts } from "@/lib/time/zones";
import {
  extractedTaskSchema,
  type ExtractedTask,
} from "@/lib/validation/extraction";

import type {
  LlmClient,
  LlmMessage,
  LlmMessageParam,
  LlmRequest,
  LlmTool,
} from "./client";
import { EXTRACT_MODEL, FALLBACK_BETA, type ModelConfig } from "./models";
import { EXTRACT_PROMPT_VERSION, EXTRACT_SYSTEM } from "./prompts/extract";

// Notes → tasks (docs/plan.md §3.3). Each add_task call is validated as soon as
// its block completes and streamed out; invalid calls get one retry turn.

export type ExtractInput = {
  note: { kind: "text"; text: string } | { kind: "pdf"; base64: string };
  now: Date;
  timezone: string;
  userName: string;
  projects: { id: string; name: string }[];
  includeOthers: boolean;
};

export type ExtractEvent =
  | { type: "task"; task: ExtractedTask }
  | { type: "done"; invalid: number; stopReason: string | null };

export const ADD_TASK_TOOL: LlmTool = {
  name: "add_task",
  description:
    "Add one action item found in the note. Call once per task, all in one response.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "assignee",
      "due_date",
      "due_time",
      "project_id",
      "confidence",
      "source_quote",
    ],
    properties: {
      title: {
        type: "string",
        description: "Short imperative title, in English.",
      },
      assignee: {
        type: "string",
        description:
          "\"me\" for the user's own tasks, otherwise the person's name.",
      },
      due_date: {
        type: ["string", "null"],
        description: "YYYY-MM-DD in the user's time zone, or null.",
      },
      due_time: {
        type: ["string", "null"],
        description:
          "HH:mm (24-hour) only if a specific time is given, else null.",
      },
      project_id: {
        type: ["string", "null"],
        description: "An id from the project list, or null.",
      },
      confidence: { type: "number", description: "0 to 1." },
      source_quote: {
        type: "string",
        description:
          "Shortest exact excerpt from the note supporting the task.",
      },
    },
  },
};

/** Per-request facts, after the cacheable system prompt. */
export function contextText(input: ExtractInput): string {
  const { date, time } = toLocalParts(input.now, input.timezone);
  const days = calendar(input.now, input.timezone, 21)
    .map((d, i) => `${d.date} ${d.weekday}${i === 0 ? " (today)" : ""}`)
    .join("\n");
  return [
    `Today: ${date} ${calendar(input.now, input.timezone, 1)[0].weekday}, now ${time}, time zone ${input.timezone}`,
    `User: ${input.userName}`,
    `include_others: ${input.includeOthers}`,
    `Projects (id: name):\n${
      input.projects.map((p) => `${p.id}: ${p.name}`).join("\n") || "(none)"
    }`,
    `Calendar:\n${days}`,
  ].join("\n\n");
}

function firstMessage(input: ExtractInput): LlmMessageParam {
  // A random tag name, so text in the note can't close the tag (injection).
  const tag = `note-${randomBytes(6).toString("hex")}`;
  const context = contextText(input);
  if (input.note.kind === "pdf") {
    return {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: input.note.base64,
          },
        },
        {
          type: "text",
          text: `${context}\n\nThe attached document is the note. Extract its tasks.`,
        },
      ],
    };
  }
  return {
    role: "user",
    content: `${context}\n\n<${tag}>\n${input.note.text}\n</${tag}>\n\nExtract the tasks from the note between the ${tag} tags.`,
  };
}

function request(config: ModelConfig, messages: LlmMessageParam[]): LlmRequest {
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    // Cache breakpoint at the end of the stable prefix (tools, then system).
    system: [
      {
        type: "text",
        text: EXTRACT_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [ADD_TASK_TOOL],
    // Forced tool choice is a 400 on current models; the prompt steers instead.
    tool_choice: { type: "auto" },
    messages,
    ...(config.effort ? { output_config: { effort: config.effort } } : {}),
    ...(config.fallbacks
      ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
      : {}),
  };
}

const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function zodMessage(e: { issues: { path: PropertyKey[]; message: string }[] }) {
  return e.issues
    .map((i) => `${i.path.map(String).join(".") || "input"}: ${i.message}`)
    .join("; ");
}

/**
 * Streams validated tasks. `onMessage` receives every final API message (for
 * usage logging) even if the consumer stops early.
 */
export async function* extractTasks(
  client: LlmClient,
  input: ExtractInput,
  opts: {
    onMessage?: (m: LlmMessage) => void;
    signal?: AbortSignal;
    config?: ModelConfig;
  } = {},
): AsyncGenerator<ExtractEvent> {
  const config = opts.config ?? EXTRACT_MODEL;
  const projectIds = new Set(input.projects.map((p) => p.id));
  const seen = new Set<string>();
  const messages: LlmMessageParam[] = [firstMessage(input)];
  let invalid = 0;
  let stopReason: string | null = null;

  // Turn 1, plus at most one retry turn for invalid calls.
  for (let turn = 0; turn < 2; turn++) {
    const results: { id: string; error: string | null }[] = [];
    let final: LlmMessage | undefined;

    for await (const item of client.stream(
      request(config, messages),
      opts.signal,
    )) {
      if (item.type === "message") {
        final = item.message;
        opts.onMessage?.(item.message);
        continue;
      }
      if (item.type !== "block") continue;
      const block = item.block;
      if (block.type !== "tool_use" || block.name !== ADD_TASK_TOOL.name)
        continue;

      const parsed = extractedTaskSchema.safeParse(block.input);
      if (!parsed.success) {
        results.push({ id: block.id, error: zodMessage(parsed.error) });
        continue;
      }
      results.push({ id: block.id, error: null });
      const task = parsed.data;
      // Only ids from the user's own list survive (never an invented one).
      if (task.project_id && !projectIds.has(task.project_id))
        task.project_id = null;
      const key = normTitle(task.title);
      if (seen.has(key)) continue;
      seen.add(key);
      yield { type: "task", task };
    }

    stopReason = final?.stop_reason ?? null;
    const failed = results.filter((r) => r.error !== null);
    // A refusal or truncation ends extraction; so does a clean turn.
    if (
      !final ||
      failed.length === 0 ||
      stopReason === "refusal" ||
      stopReason === "max_tokens"
    ) {
      invalid += failed.length;
      break;
    }
    if (turn === 1) {
      invalid += failed.length;
      break;
    }

    // Retry: answer every tool call, with the Zod error for the invalid ones.
    messages.push({ role: "assistant", content: final.content });
    messages.push({
      role: "user",
      content: [
        ...results.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.id,
          ...(r.error
            ? { is_error: true, content: `Invalid: ${r.error}` }
            : { content: "ok" }),
        })),
        {
          type: "text" as const,
          text: "Call add_task again only for the invalid calls, corrected. Don't repeat the others.",
        },
      ],
    });
  }

  yield { type: "done", invalid, stopReason };
}

export { EXTRACT_PROMPT_VERSION };
