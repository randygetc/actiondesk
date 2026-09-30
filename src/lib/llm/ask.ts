import "server-only";

import { randomUUID } from "node:crypto";

import { calendar, toLocalParts } from "@/lib/time/zones";
import type { ChatTurn, CreateTaskProposal } from "@/lib/validation/ask";

import type {
  LlmClient,
  LlmContentBlock,
  LlmMessage,
  LlmMessageParam,
  LlmRequest,
} from "./client";
import { ASK_MODEL, FALLBACK_BETA, type ModelConfig } from "./models";
import { ASK_SYSTEM } from "./prompts/ask";
import { ASK_TOOLS } from "./tools/tasks";
import type { AskTool, ToolContext } from "./tools/types";

// Ask ActionDesk (docs/plan.md §3.3): a tool loop of at most MAX_ROUNDS tool
// rounds, then a forced text answer. Tools run with the user's client
// (ADR-0003); create_task only yields a proposal (R4).

export const MAX_ROUNDS = 5;

export type AskEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; summary: string }
  | { type: "proposal"; id: string; proposal: CreateTaskProposal }
  | { type: "done"; stopReason: string | null };

export type AskContext = ToolContext & {
  userName: string;
  projects: { id: string; name: string }[];
};

const TOOLS_BY_NAME = new Map<string, AskTool>(
  ASK_TOOLS.map((t) => [t.definition.name, t as AskTool]),
);

function contextText(ctx: AskContext): string {
  const { date, time } = toLocalParts(ctx.now, ctx.timezone);
  const weekday = calendar(ctx.now, ctx.timezone, 1)[0].weekday;
  const projects =
    ctx.projects.map((p) => `${p.id}: ${p.name}`).join("\n") || "(none)";
  return `Context: today is ${weekday} ${date}, ${time}, time zone ${ctx.timezone}. The user is ${ctx.userName}.\nProjects (id: name):\n${projects}`;
}

/** History is text only; the API needs the first message to be the user's. */
function toMessages(
  ctx: AskContext,
  history: ChatTurn[],
  question: string,
): LlmMessageParam[] {
  const first = history.findIndex((t) => t.role === "user");
  const past =
    first === -1
      ? []
      : history.slice(first).map((t) => ({ role: t.role, content: t.text }));
  return [
    ...past,
    { role: "user", content: `${contextText(ctx)}\n\nQuestion: ${question}` },
  ];
}

function request(
  config: ModelConfig,
  messages: LlmMessageParam[],
  finalRound: boolean,
): LlmRequest {
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    system: ASK_SYSTEM,
    tools: ASK_TOOLS.map((t) => t.definition),
    // The last round must answer in text; forced tool use isn't allowed anyway.
    tool_choice: { type: finalRound ? "none" : "auto" },
    messages,
    ...(config.effort ? { output_config: { effort: config.effort } } : {}),
    ...(config.fallbacks
      ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
      : {}),
  };
}

type ToolUse = Extract<LlmContentBlock, { type: "tool_use" }>;

function issues(e: { issues: { path: PropertyKey[]; message: string }[] }) {
  return e.issues
    .map((i) => `${i.path.map(String).join(".") || "input"}: ${i.message}`)
    .join("; ");
}

export async function* ask(
  client: LlmClient,
  ctx: AskContext,
  input: { history: ChatTurn[]; question: string },
  opts: {
    onMessage?: (m: LlmMessage) => void;
    onToolError?: (name: string, error: unknown) => void;
    signal?: AbortSignal;
    config?: ModelConfig;
  } = {},
): AsyncGenerator<AskEvent> {
  const config = opts.config ?? ASK_MODEL;
  const messages = toMessages(ctx, input.history, input.question);
  let stopReason: string | null = null;
  let wroteText = false;

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    let final: LlmMessage | undefined;
    // Text from separate rounds (before and after a tool call) gets a break.
    let roundText = false;
    for await (const item of client.stream(
      request(config, messages, round === MAX_ROUNDS),
      opts.signal,
    )) {
      if (item.type === "text") {
        if (!roundText && wroteText) yield { type: "text", text: "\n\n" };
        roundText = wroteText = true;
        yield { type: "text", text: item.text };
      } else if (item.type === "message") {
        final = item.message;
        opts.onMessage?.(item.message);
      }
    }
    stopReason = final?.stop_reason ?? null;
    if (!final || stopReason !== "tool_use") break;

    const calls = final.content.filter(
      (b): b is ToolUse => b.type === "tool_use",
    );
    const results = [];
    for (const call of calls) {
      const tool = TOOLS_BY_NAME.get(call.name);
      const parsed = tool?.input.safeParse(call.input);
      if (!tool || !parsed?.success) {
        results.push({
          type: "tool_result" as const,
          tool_use_id: call.id,
          is_error: true,
          content: tool
            ? `Invalid input: ${issues(parsed!.error!)}`
            : `Unknown tool: ${call.name}`,
        });
        continue;
      }
      yield {
        type: "tool_call",
        name: call.name,
        summary: tool.describe(parsed.data),
      };
      try {
        const out = await tool.run(ctx, parsed.data);
        if (out.proposal)
          yield { type: "proposal", id: randomUUID(), proposal: out.proposal };
        results.push({
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: JSON.stringify(out.result),
        });
      } catch (e) {
        opts.onToolError?.(call.name, e);
        results.push({
          type: "tool_result" as const,
          tool_use_id: call.id,
          is_error: true,
          content: "The tool failed. Tell the user you couldn't look this up.",
        });
      }
    }
    messages.push({ role: "assistant", content: final.content });
    messages.push({ role: "user", content: results });
  }

  yield { type: "done", stopReason };
}
