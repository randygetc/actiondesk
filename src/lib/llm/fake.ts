import "server-only";

import type { LlmClient, LlmContentBlock, LlmMessage } from "./client";

/**
 * A deterministic stand-in for the API, for e2e tests and local work without a
 * key (R-21). Every "- " bullet in the note becomes one add_task call; a date
 * written as "by YYYY-MM-DD" becomes its due date, and "?" marks low confidence.
 * Never active in production (see isFakeLlm).
 */
export const fakeClient: LlmClient = {
  async *stream(request) {
    const first = request.messages[0]?.content;
    const text = typeof first === "string" ? first : "";
    // Only lines between the note tags, not the context above them.
    const note =
      text.match(/<(note-[0-9a-f]+)>\n([\s\S]*?)\n<\/\1>/)?.[2] ?? "";
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

/** LLM_FAKE=1 swaps in the fake, outside production only. */
export function isFakeLlm(): boolean {
  return process.env.LLM_FAKE === "1" && process.env.NODE_ENV !== "production";
}
