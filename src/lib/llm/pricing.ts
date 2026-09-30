import "server-only";

// USD per million tokens, from the Anthropic docs (claude-api skill, pricing
// cached 2026-09-25), checked 2026-09-30 (rule 8, R-15). Cache writes use the
// 5-minute TTL (1.25x input).

type Price = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": {
    input: 2,
    output: 10,
    cacheWrite: 2.5,
    cacheRead: 0.2,
  },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/** Unknown models (e.g. a new fallback) are priced at the most expensive known rate. */
const WORST_CASE: Price = {
  input: 5,
  output: 25,
  cacheWrite: 6.25,
  cacheRead: 0.5,
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function isKnownModel(model: string): boolean {
  return model in PRICES;
}

/** Cost in USD, from the API's usage numbers only (trust boundary 7). */
export function costUsd(model: string, usage: TokenUsage): number {
  const p = PRICES[model] ?? WORST_CASE;
  const cost =
    usage.input_tokens * p.input +
    usage.output_tokens * p.output +
    (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead;
  // Prices are per million tokens, so `cost` is in micro-dollars: exactly the
  // six decimals llm_usage.cost_usd (numeric(10,6)) keeps.
  return Math.round(cost) / 1_000_000;
}
