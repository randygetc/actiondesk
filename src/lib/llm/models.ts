import "server-only";

// Model per feature (rule 8, R-15). IDs and settings were checked against the
// Anthropic docs (claude-api skill, model table cached 2026-09-25) on
// 2026-09-30. Step 2.4 compares models on the eval and may change these.

export type ModelConfig = {
  model: string;
  /** Opus 5.5 / Sonnet 5.5 only; Haiku 4.5 rejects the effort parameter. */
  effort?: "low" | "medium" | "high";
  /** Server-side refusal fallback (`fallbacks: "default"`). */
  fallbacks: boolean;
  maxTokens: number;
};

export const EXTRACT_MODEL: ModelConfig = {
  // Owner decision at 2.4: same eval score as claude-opus-5-5 (98%) at 47% of
  // the cost and ~2x the speed (docs/learnings.md).
  model: "claude-sonnet-5-5",
  // Sonnet 5.5 defaults to high; medium matched Opus on the eval.
  effort: "medium",
  fallbacks: true,
  maxTokens: 16_000,
};

export const ASK_MODEL: ModelConfig = {
  // Same model as extraction (2.4); low effort suits chat (claude-api docs).
  model: "claude-sonnet-5-5",
  effort: "low",
  fallbacks: true,
  maxTokens: 8_000,
};

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
