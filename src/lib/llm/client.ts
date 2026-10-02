import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// The only import of the Anthropic SDK (ADR-0002, R2). Everything else talks
// to the narrow LlmClient below, so evals and tests can replay recordings.

export type LlmRequest = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];
export type LlmMessage = Anthropic.Beta.Messages.BetaMessage;
export type LlmContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
export type LlmMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type LlmTool = Anthropic.Beta.Messages.BetaTool;

/**
 * Usage so far for the call in flight: input tokens from message_start, and
 * output tokens from message_delta or, until then, estimated from the
 * streamed characters. Lets an aborted call still be charged (review #1).
 */
export type LlmUsage = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

/** Text as it streams, usage so far, each content block as it completes, then the final message. */
export type LlmStreamItem =
  | { type: "text"; text: string }
  | { type: "usage"; usage: LlmUsage }
  | { type: "block"; block: LlmContentBlock }
  | { type: "message"; message: LlmMessage };

export interface LlmClient {
  stream(
    request: LlmRequest,
    signal?: AbortSignal,
  ): AsyncIterable<LlmStreamItem>;
  /** Input tokens a request would use (free endpoint). Absent for fakes and replays. */
  countTokens?(request: LlmRequest): Promise<number>;
}

let sdk: Anthropic | undefined;

/** Reads ANTHROPIC_API_KEY from the server environment; never sent to the browser. */
function anthropic(): Anthropic {
  sdk ??= new Anthropic();
  return sdk;
}

/** Roughly 3 characters per token; errs toward charging more. */
const CHARS_PER_TOKEN = 3;
const USAGE_EVERY_CHARS = 600;

export const anthropicClient: LlmClient = {
  async *stream(request, signal) {
    const s = anthropic().beta.messages.stream(request, { signal });
    let usage: LlmUsage | undefined;
    let chars = 0;
    let reportedAt = 0;
    for await (const event of s) {
      if (event.type === "message_start") {
        const u = event.message.usage;
        usage = {
          model: event.message.model,
          input_tokens: u.input_tokens,
          output_tokens: u.output_tokens,
          cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        };
        yield { type: "usage", usage: { ...usage } };
      } else if (event.type === "message_delta" && usage) {
        usage.output_tokens = Math.max(
          usage.output_tokens,
          event.usage.output_tokens,
        );
        yield { type: "usage", usage: { ...usage } };
      } else if (event.type === "content_block_delta") {
        const d = event.delta;
        chars +=
          d.type === "text_delta"
            ? d.text.length
            : d.type === "input_json_delta"
              ? d.partial_json.length
              : d.type === "thinking_delta"
                ? d.thinking.length
                : 0;
        if (d.type === "text_delta") yield { type: "text", text: d.text };
        if (usage && chars - reportedAt >= USAGE_EVERY_CHARS) {
          reportedAt = chars;
          usage.output_tokens = Math.max(
            usage.output_tokens,
            Math.ceil(chars / CHARS_PER_TOKEN),
          );
          yield { type: "usage", usage: { ...usage } };
        }
      } else if (event.type === "content_block_stop") {
        const block = s.currentMessage?.content[event.index];
        if (block) yield { type: "block", block };
      }
    }
    yield { type: "message", message: await s.finalMessage() };
  },

  async countTokens(request) {
    const { model, system, tools, messages } = request;
    const r = await anthropic().beta.messages.countTokens({
      model,
      system,
      tools,
      messages,
    });
    return r.input_tokens;
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
      for (const block of message.content) {
        if (block.type === "text") yield { type: "text", text: block.text };
        yield { type: "block", block };
      }
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

export type ErrorDetail = {
  status: number | null;
  /** "api" for API responses, else the JS error name. */
  kind: string;
  /** The API's `error.type`, e.g. "authentication_error". */
  type: string | null;
  /** A fixed code for known client-side failures. */
  reason: string | null;
};

/**
 * What a log line may say about an LLM error (rule 12, review #8): fixed codes
 * only, never a message, since messages can quote model output or note text.
 * Client-side SDK errors are matched by message prefix, not instanceof: the
 * SDK can load twice (ESM and CJS), and then instanceof fails.
 */
export function errorDetail(e: unknown): ErrorDetail {
  if (e instanceof Anthropic.APIError) {
    return {
      status: e.status ?? null,
      kind: "api",
      type: e.type ?? null,
      reason:
        e instanceof Anthropic.APIConnectionTimeoutError
          ? "timeout"
          : e instanceof Anthropic.APIConnectionError
            ? "connection"
            : null,
    };
  }
  const message = e instanceof Error ? e.message : "";
  return {
    status: null,
    kind: e instanceof Error ? e.name : "unknown",
    type: null,
    // A missing or misnamed ANTHROPIC_API_KEY (2026-10-02 incident).
    reason: message.startsWith("Could not resolve authentication method")
      ? "missing_credentials"
      : null,
  };
}

export function isAbort(e: unknown): boolean {
  return (
    e instanceof Anthropic.APIUserAbortError ||
    (e instanceof Error && e.name === "AbortError")
  );
}
