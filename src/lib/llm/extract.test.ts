import { describe, expect, it } from "vitest";

import type {
  LlmClient,
  LlmContentBlock,
  LlmMessage,
  LlmRequest,
} from "./client";
import { extractTasks, type ExtractEvent, type ExtractInput } from "./extract";

const P1 = "00000000-0000-4000-8000-000000000001";

const input: ExtractInput = {
  note: { kind: "text", text: "Randy: send the deck by Friday" },
  now: new Date("2026-10-06T01:15:00Z"), // Tue 09:15 in Manila
  timezone: "Asia/Manila",
  userName: "Randy",
  projects: [{ id: P1, name: "Website" }],
  includeOthers: false,
};

const task = (over: Record<string, unknown> = {}) => ({
  title: "Send the deck",
  assignee: "me",
  due_date: "2026-10-09",
  due_time: null,
  project_id: null,
  confidence: 0.9,
  source_quote: "send the deck by Friday",
  ...over,
});

let n = 0;
const toolUse = (inp: unknown): LlmContentBlock =>
  ({
    type: "tool_use",
    id: `toolu_${++n}`,
    name: "add_task",
    input: inp,
  }) as LlmContentBlock;

const message = (
  content: LlmContentBlock[],
  stop_reason: LlmMessage["stop_reason"] = "tool_use",
): LlmMessage =>
  ({
    id: `msg_${++n}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 100 },
  }) as unknown as LlmMessage;

/** Replays responses and keeps the requests it was sent. */
function scripted(...responses: LlmMessage[]) {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    async *stream(request) {
      // Snapshot: extract mutates its messages array between turns.
      requests.push(structuredClone(request));
      const m = responses[requests.length - 1];
      if (!m) throw new Error("unexpected request");
      for (const block of m.content) yield { type: "block", block };
      yield { type: "message", message: m };
    },
  };
  return { client, requests };
}

async function collect(gen: AsyncGenerator<ExtractEvent>) {
  const events: ExtractEvent[] = [];
  for await (const e of gen) events.push(e);
  return {
    tasks: events.flatMap((e) => (e.type === "task" ? [e.task] : [])),
    done: events.at(-1),
  };
}

describe("extractTasks", () => {
  it("streams each valid add_task call as a task", async () => {
    const { client, requests } = scripted(
      message([toolUse(task()), toolUse(task({ title: "Book the venue" }))]),
    );
    const { tasks, done } = await collect(extractTasks(client, input));
    expect(tasks.map((t) => t.title)).toEqual([
      "Send the deck",
      "Book the venue",
    ]);
    expect(done).toEqual({ type: "done", invalid: 0, stopReason: "tool_use" });
    expect(requests).toHaveLength(1);
  });

  it("sends a strict tool, auto tool choice, and the note inside a random tag", async () => {
    const { client, requests } = scripted(message([], "end_turn"));
    await collect(extractTasks(client, input));
    const r = requests[0];
    expect(r.tools?.[0]).toMatchObject({ name: "add_task", strict: true });
    expect(r.tool_choice).toEqual({ type: "auto" });
    const text = r.messages[0].content as string;
    const tag = text.match(/<(note-[0-9a-f]{12})>/)?.[1];
    expect(tag).toBeDefined();
    expect(text).toContain(`</${tag}>`);
    expect(text).toContain("2026-10-06 Tue (today)");
    expect(text).toContain("2026-10-16 Fri");
  });

  it("sends a PDF as a document block", async () => {
    const { client, requests } = scripted(message([], "end_turn"));
    await collect(
      extractTasks(client, {
        ...input,
        note: { kind: "pdf", base64: "JVBERi0=" },
      }),
    );
    const content = requests[0].messages[0].content as { type: string }[];
    expect(content[0]).toMatchObject({ type: "document" });
  });

  it("drops a project id that isn't the user's", async () => {
    const { client } = scripted(
      message([
        toolUse(task({ project_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" })),
      ]),
    );
    const { tasks } = await collect(extractTasks(client, input));
    expect(tasks[0].project_id).toBeNull();
  });

  it("keeps a project id from the user's list", async () => {
    const { client } = scripted(message([toolUse(task({ project_id: P1 }))]));
    const { tasks } = await collect(extractTasks(client, input));
    expect(tasks[0].project_id).toBe(P1);
  });

  it("merges tasks with the same title", async () => {
    const { client } = scripted(
      message([toolUse(task()), toolUse(task({ title: "  send the DECK " }))]),
    );
    const { tasks } = await collect(extractTasks(client, input));
    expect(tasks).toHaveLength(1);
  });

  it("retries invalid calls once with the Zod error, then streams the fix", async () => {
    const bad = toolUse(task({ due_date: "2026-02-30" }));
    const { client, requests } = scripted(
      message([toolUse(task({ title: "Book the venue" })), bad]),
      message([toolUse(task())], "end_turn"),
    );
    const { tasks, done } = await collect(extractTasks(client, input));
    expect(tasks.map((t) => t.title)).toEqual([
      "Book the venue",
      "Send the deck",
    ]);
    expect(done).toMatchObject({ invalid: 0 });

    const retry = requests[1].messages.at(-1)!.content as {
      type: string;
      tool_use_id?: string;
      is_error?: boolean;
      content?: string;
    }[];
    const badId = (bad as { id: string }).id;
    const result = retry.find((b) => b.tool_use_id === badId);
    expect(result?.is_error).toBe(true);
    expect(result?.content).toMatch(/due_date: Not a real date/);
    // Every tool call is answered, valid ones with "ok".
    expect(retry.filter((b) => b.type === "tool_result")).toHaveLength(2);
  });

  it("drops calls still invalid after the retry and counts them", async () => {
    const { client, requests } = scripted(
      message([toolUse(task({ confidence: 7 }))]),
      message([toolUse(task({ confidence: 8 }))], "end_turn"),
    );
    const { tasks, done } = await collect(extractTasks(client, input));
    expect(tasks).toEqual([]);
    expect(done).toMatchObject({ invalid: 1 });
    expect(requests).toHaveLength(2);
  });

  it("rejects a time without a date", async () => {
    const { client } = scripted(
      message(
        [toolUse(task({ due_date: null, due_time: "09:00" }))],
        "end_turn",
      ),
      message([], "end_turn"),
    );
    const { tasks } = await collect(extractTasks(client, input));
    expect(tasks).toEqual([]);
  });

  it("doesn't retry after a refusal", async () => {
    const { client, requests } = scripted(
      message([toolUse(task({ confidence: 7 }))], "refusal"),
    );
    const { done } = await collect(extractTasks(client, input));
    expect(done).toMatchObject({ stopReason: "refusal", invalid: 1 });
    expect(requests).toHaveLength(1);
  });

  it("ignores text and other tools", async () => {
    const { client } = scripted(
      message(
        [
          { type: "text", text: "none", citations: null } as LlmContentBlock,
          { ...toolUse(task()), name: "mark_all_done" } as LlmContentBlock,
        ],
        "end_turn",
      ),
    );
    const { tasks } = await collect(extractTasks(client, input));
    expect(tasks).toEqual([]);
  });

  it("reports every API message for usage logging", async () => {
    const seen: string[] = [];
    const { client } = scripted(
      message([toolUse(task({ confidence: 7 }))]),
      message([toolUse(task())], "end_turn"),
    );
    await collect(
      extractTasks(client, input, { onMessage: (m) => seen.push(m.id) }),
    );
    expect(seen).toHaveLength(2);
  });
});
