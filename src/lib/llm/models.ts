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
  model: "claude-opus-5-5",
  // Opus 5.5 defaults to medium; set it explicitly (thinking can't be disabled).
  effort: "medium",
  fallbacks: true,
  maxTokens: 16_000,
};

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
