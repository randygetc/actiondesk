import { describe, expect, it } from "vitest";

import { fakeSupabase } from "../../../test/fake-supabase";

import { ask, MAX_ROUNDS, type AskContext, type AskEvent } from "./ask";
import type {
  LlmClient,
  LlmContentBlock,
  LlmMessage,
  LlmRequest,
} from "./client";

function context(rows: unknown[] = []) {
  const db = fakeSupabase(rows);
  const ctx: AskContext = {
    supabase: db.client,
    now: new Date("2026-10-06T01:15:00Z"),
    timezone: "Asia/Manila",
    userName: "Randy",
    projects: [],
  };
  return { ctx, writes: db.writes };
}

let n = 0;
const text = (t: string) =>
  ({ type: "text", text: t, citations: null }) as LlmContentBlock;
const toolUse = (name: string, input: unknown) =>
  ({ type: "tool_use", id: `toolu_${++n}`, name, input }) as LlmContentBlock;
const message = (
  content: LlmContentBlock[],
  stop_reason = "end_turn",
): LlmMessage =>
  ({
    id: `msg_${++n}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  }) as unknown as LlmMessage;

function scripted(...responses: LlmMessage[]) {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    async *stream(request) {
      requests.push(structuredClone(request));
      const m = responses[Math.min(requests.length, responses.length) - 1];
      for (const block of m.content) {
        if (block.type === "text") yield { type: "text", text: block.text };
        yield { type: "block", block };
      }
      yield { type: "message", message: m };
    },
  };
  return { client, requests };
}

async function collect(gen: AsyncGenerator<AskEvent>) {
  const events: AskEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const q = (
  question: string,
  history: { role: "user" | "assistant"; text: string }[] = [],
) => ({
  history,
  question,
});

describe("ask", () => {
  it("streams a plain answer", async () => {
    const { client } = scripted(message([text("You have no tasks.")]));
    const events = await collect(ask(client, context().ctx, q("What's due?")));
    expect(events).toEqual([
      { type: "text", text: "You have no tasks." },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("runs a tool, shows the call, and sends the result back", async () => {
    const { client, requests } = scripted(
      message([toolUse("list_overdue", {})], "tool_use"),
      message([text("Nothing is overdue.")]),
    );
    const events = await collect(
      ask(client, context().ctx, q("What's overdue?")),
    );
    expect(events).toContainEqual({
      type: "tool_call",
      name: "list_overdue",
      summary: "Checked overdue tasks",
    });
    const results = requests[1].messages.at(-1)!.content as {
      type: string;
      content: string;
    }[];
    expect(results[0]).toMatchObject({
      type: "tool_result",
      content: '{"tasks":[]}',
    });
  });

  it("separates text written before and after a tool call", async () => {
    const { client } = scripted(
      message([text("Let me check."), toolUse("list_overdue", {})], "tool_use"),
      message([text("Nothing is overdue.")]),
    );
    const events = await collect(
      ask(client, context().ctx, q("What's overdue?")),
    );
    const said = events
      .flatMap((e) => (e.type === "text" ? [e.text] : []))
      .join("");
    expect(said).toBe("Let me check.\n\nNothing is overdue.");
  });

  it("create_task yields a proposal and writes nothing (R4)", async () => {
    const { ctx, writes } = context();
    const { client } = scripted(
      message(
        [
          toolUse("create_task", {
            title: "Buy milk",
            due_date: "2026-10-07",
            due_time: null,
            project_id: null,
            priority: "normal",
          }),
        ],
        "tool_use",
      ),
      message([text("I've proposed it; please confirm.")]),
    );
    const events = await collect(
      ask(client, ctx, q("Add a task to buy milk tomorrow")),
    );
    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal).toMatchObject({
      proposal: {
        title: "Buy milk",
        dueDate: "2026-10-07",
        priority: "normal",
      },
    });
    expect(writes).toEqual([]);
  });

  it("rejects invalid tool input without running the tool", async () => {
    const { client, requests } = scripted(
      message(
        [toolUse("get_project_summary", { project_id: "not-a-uuid" })],
        "tool_use",
      ),
      message([text("I couldn't find that project.")]),
    );
    const events = await collect(
      ask(client, context().ctx, q("Summarize Website")),
    );
    expect(events.some((e) => e.type === "tool_call")).toBe(false);
    const result = (
      requests[1].messages.at(-1)!.content as {
        is_error?: boolean;
        content: string;
      }[]
    )[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/project_id/);
  });

  it("refuses tools it doesn't have", async () => {
    const { client, requests } = scripted(
      message([toolUse("delete_all_tasks", {})], "tool_use"),
      message([text("I can't do that.")]),
    );
    await collect(ask(client, context().ctx, q("Delete everything")));
    const result = (
      requests[1].messages.at(-1)!.content as {
        is_error?: boolean;
        content: string;
      }[]
    )[0];
    expect(result).toMatchObject({
      is_error: true,
      content: "Unknown tool: delete_all_tasks",
    });
  });

  it(`stops tool use after ${MAX_ROUNDS} rounds and forces a text answer`, async () => {
    const { client, requests } = scripted(
      message([toolUse("list_overdue", {})], "tool_use"),
    );
    await collect(ask(client, context().ctx, q("Loop forever")));
    expect(requests).toHaveLength(MAX_ROUNDS + 1);
    expect(requests.at(-1)!.tool_choice).toEqual({ type: "none" });
    expect(requests[0].tool_choice).toEqual({ type: "auto" });
  });

  it("reports a failing tool to the model and the caller", async () => {
    const failing = context().ctx;
    failing.supabase = {
      from: () => {
        throw new Error("db down");
      },
    } as never;
    const errors: string[] = [];
    const { client, requests } = scripted(
      message([toolUse("list_overdue", {})], "tool_use"),
      message([text("Sorry, I couldn't look that up.")]),
    );
    await collect(
      ask(client, failing, q("What's overdue?"), {
        onToolError: (name) => errors.push(name),
      }),
    );
    expect(errors).toEqual(["list_overdue"]);
    const result = (
      requests[1].messages.at(-1)!.content as { is_error?: boolean }[]
    )[0];
    expect(result.is_error).toBe(true);
  });

  it("sends text history only, starting with a user turn, and today's context last", async () => {
    const { client, requests } = scripted(message([text("ok")]));
    await collect(
      ask(
        client,
        context().ctx,
        q("And tomorrow?", [
          { role: "assistant", text: "Hi! Ask me anything." },
          { role: "user", text: "What's due today?" },
          { role: "assistant", text: "Nothing." },
        ]),
      ),
    );
    const msgs = requests[0].messages;
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[0].content).toBe("What's due today?");
    expect(msgs.at(-1)!.content).toMatch(/today is Tue 2026-10-06/);
    expect(msgs.at(-1)!.content).toMatch(/Question: And tomorrow\?$/);
  });
});
