import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { errorDetail } from "./client";

describe("errorDetail (log-safe LLM error codes)", () => {
  it("names a missing API key, the 2026-10-02 incident", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const client = new Anthropic({ maxRetries: 0 });
      const e = await client.messages
        .create({
          model: "claude-sonnet-5-5",
          max_tokens: 1,
          messages: [{ role: "user", content: "x" }],
        })
        .catch((err: unknown) => err);
      expect(errorDetail(e)).toEqual({
        status: null,
        kind: "Error",
        type: null,
        reason: "missing_credentials",
      });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("gives the status and API error type, never the message", () => {
    const e = Anthropic.APIError.generate(
      401,
      {
        type: "error",
        error: { type: "authentication_error", message: "secret note text" },
      },
      undefined,
      new Headers(),
    );
    const detail = errorDetail(e);
    expect(detail).toEqual({
      status: 401,
      kind: "api",
      type: "authentication_error",
      reason: null,
    });
    expect(JSON.stringify(detail)).not.toContain("secret note text");
  });

  it("marks connection failures and timeouts", () => {
    expect(errorDetail(new Anthropic.APIConnectionError({})).reason).toBe(
      "connection",
    );
    expect(errorDetail(new Anthropic.APIConnectionTimeoutError()).reason).toBe(
      "timeout",
    );
  });

  it("keeps other SDK messages out (they can quote model output)", () => {
    const e = new Anthropic.AnthropicError(
      'Unable to parse tool parameter JSON from model. JSON: {"title":"secret"',
    );
    expect(errorDetail(e)).toEqual({
      status: null,
      kind: "Error",
      type: null,
      reason: null,
    });
  });

  it("uses only the name for non-SDK errors", () => {
    expect(errorDetail(new TypeError("note text"))).toEqual({
      status: null,
      kind: "TypeError",
      type: null,
      reason: null,
    });
    expect(errorDetail("x").kind).toBe("unknown");
  });
});
