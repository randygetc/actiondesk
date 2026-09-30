import "server-only";

import { anthropicClient, type LlmClient } from "./client";
import { fakeClient, isFakeLlm } from "./fake";

// The LLM module's entry point for app code (ADR-0002). Features call
// llmClient() rather than choosing a client themselves.

export function llmClient(): LlmClient {
  return isFakeLlm() ? fakeClient : anthropicClient;
}

export { isFakeLlm };
