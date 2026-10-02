import "server-only";

import type {
  LlmClient,
  LlmContentBlock,
  LlmMessage,
  LlmRequest,
} from "./client";

/**
 * A deterministic stand-in for the API, for e2e tests and local work without a
 * key (R-21). Every "- " bullet in the note becomes one add_task call; a date
 * written as "by YYYY-MM-DD" becomes its due date, and "?" marks low confidence.
 * A "[fake:error]" line makes the call fail, for failure-path tests.
 * Never active in production (see isFakeLlm).
 */
const fakeExtract: LlmClient = {
  async *stream(request) {
    const first = request.messages[0]?.content;
    const text = typeof first === "string" ? first : "";
    // Only lines between the note tags, not the context above them.
    const note =
      text.match(/<(note-[0-9a-f]+)>\n([\s\S]*?)\n<\/\1>/)?.[2] ?? "";
    if (note.includes("[fake:error]")) throw new Error("Fake model failure");
    let n = 0;
    const content: LlmContentBlock[] = note.split("\n").flatMap((line) => {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim();
      if (!bullet) return [];
      const due = bullet.match(/\bby (\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null;
      return [
        {
          type: "tool_use",
          id: `toolu_fake_${++n}`,
          name: "add_task",
          input: {
            title: bullet
              .replace(/\s*\bby \d{4}-\d{2}-\d{2}\b/, "")
              .replace(/\?$/, ""),
            assignee: "me",
            due_date: due,
            due_time: null,
            project_id: null,
            confidence: bullet.endsWith("?") ? 0.4 : 0.9,
            source_quote: bullet,
          },
        } as LlmContentBlock,
      ];
    });

    const message = {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "fake",
      content,
      stop_reason: content.length ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as LlmMessage;

    for (const block of content) {
      await new Promise((r) => setTimeout(r, 150));
      yield { type: "block", block };
    }
    yield { type: "message", message };
  },
};

type Block = LlmContentBlock;

function reply(content: Block[], stopReason: string): LlmMessage {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "fake",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as LlmMessage;
}

/** Picks a tool by keyword, then answers from the tool result. */
function fakeAskTurn(request: LlmRequest): LlmMessage {
  const last = request.messages.at(-1)?.content;

  if (Array.isArray(last)) {
    const r = last.find((b) => b.type === "tool_result");
    const data = JSON.parse(
      r && typeof r.content === "string" ? r.content : "{}",
    ) as { tasks?: { title: string }[]; proposed?: boolean; found?: boolean };
    const answer = data.proposed
      ? "I've proposed that task. Confirm it to save it."
      : data.found === false
        ? "I couldn't find that project."
        : data.tasks
          ? data.tasks.length
            ? `Found ${data.tasks.length}: ${data.tasks.map((t) => t.title).join("; ")}`
            : "Found no tasks."
          : "Done.";
    return reply(
      [{ type: "text", text: answer, citations: null } as Block],
      "end_turn",
    );
  }

  const question =
    String(last ?? "")
      .split("Question: ")
      .at(-1) ?? "";
  const call = (name: string, input: unknown) =>
    reply(
      [{ type: "tool_use", id: "toolu_fake", name, input } as Block],
      "tool_use",
    );
  const add = question.match(/^(?:add|create)[^:]*:\s*(.+)$/i)?.[1];
  if (add)
    return call("create_task", {
      title: add.trim(),
      due_date: null,
      due_time: null,
      project_id: null,
      priority: "normal",
    });
  if (/overdue/i.test(question)) return call("list_overdue", {});
  const search = question.match(/search (?:for )?(.+)/i)?.[1];
  if (search)
    return call("search_tasks", {
      query: search.trim(),
      status: null,
      project_id: null,
    });
  return reply(
    [
      {
        type: "text",
        text: "I can look up your tasks.",
        citations: null,
      } as Block,
    ],
    "end_turn",
  );
}

const fakeAsk: LlmClient = {
  async *stream(request) {
    const message = fakeAskTurn(request);
    for (const block of message.content) {
      if (block.type === "text")
        for (const word of block.text.split(/(?<= )/)) {
          await new Promise((r) => setTimeout(r, 20));
          yield { type: "text", text: word };
        }
      yield { type: "block", block };
    }
    yield { type: "message", message };
  },
};

/**
 * Deterministic stand-in for the API, for e2e and local work without a key
 * (R-21): extraction when the request has add_task, otherwise Ask.
 */
export const fakeClient: LlmClient = {
  stream(request, signal) {
    const extracting = request.tools?.some(
      (t) => "name" in t && t.name === "add_task",
    );
    return (extracting ? fakeExtract : fakeAsk).stream(request, signal);
  },
};

/** LLM_FAKE=1 swaps in the fake, outside production only. */
export function isFakeLlm(): boolean {
  return process.env.LLM_FAKE === "1" && process.env.NODE_ENV !== "production";
}
