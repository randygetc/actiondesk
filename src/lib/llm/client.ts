import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// The only import of the Anthropic SDK (ADR-0002, R2). Everything else talks
// to the narrow LlmClient below, so evals and tests can replay recordings.

export type LlmRequest = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];
export type LlmMessage = Anthropic.Beta.Messages.BetaMessage;
export type LlmContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
export type LlmMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type LlmTool = Anthropic.Beta.Messages.BetaTool;

/** A content block as soon as it completes, then the final message. */
export type LlmStreamItem =
  | { type: "block"; block: LlmContentBlock }
  | { type: "message"; message: LlmMessage };

export interface LlmClient {
  stream(
    request: LlmRequest,
    signal?: AbortSignal,
  ): AsyncIterable<LlmStreamItem>;
}

let sdk: Anthropic | undefined;

/** Reads ANTHROPIC_API_KEY from the server environment; never sent to the browser. */
function anthropic(): Anthropic {
  sdk ??= new Anthropic();
  return sdk;
}

export const anthropicClient: LlmClient = {
  async *stream(request, signal) {
    const s = anthropic().beta.messages.stream(request, { signal });
    for await (const event of s) {
      if (event.type !== "content_block_stop") continue;
      const block = s.currentMessage?.content[event.index];
      if (block) yield { type: "block", block };
    }
    yield { type: "message", message: await s.finalMessage() };
  },
};

/**
 * Replays recorded final messages, one per request, in order. Used by the
 * eval's recorded mode and by unit tests.
 */
export function replayClient(messages: LlmMessage[]): LlmClient {
  let turn = 0;
  return {
    async *stream() {
      const message = messages[turn++];
      if (!message) throw new Error(`no recorded response for request ${turn}`);
      for (const block of message.content) yield { type: "block", block };
      yield { type: "message", message };
    },
  };
}

/** Wraps a client and keeps every final message, for writing recordings. */
export function recordingClient(inner: LlmClient) {
  const recorded: LlmMessage[] = [];
  const client: LlmClient = {
    async *stream(request, signal) {
      for await (const item of inner.stream(request, signal)) {
        if (item.type === "message") recorded.push(item.message);
        yield item;
      }
    },
  };
  return { client, recorded };
}

export function isApiError(
  e: unknown,
): e is InstanceType<typeof Anthropic.APIError> {
  return e instanceof Anthropic.APIError;
}

export function isAbort(e: unknown): boolean {
  return (
    e instanceof Anthropic.APIUserAbortError ||
    (e instanceof Error && e.name === "AbortError")
  );
}
