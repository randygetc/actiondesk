import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { log } from "@/lib/log";

import type { LlmMessage, LlmUsage } from "./client";
import { costUsd, isKnownModel } from "./pricing";

type Feature = Database["public"]["Enums"]["llm_feature"];
type Outcome = Database["public"]["Enums"]["llm_outcome"];

/** Collects the final message of every API call in one feature run. */
export function usageMeter(fallbackModel: string) {
  const messages: LlmMessage[] = [];
  // Usage of the call in flight, charged if it never finishes (review #1).
  let partial: LlmUsage | undefined;
  const startedAt = performance.now();
  return {
    add(m: LlmMessage) {
      messages.push(m);
      partial = undefined;
    },
    partial(u: LlmUsage) {
      partial = u;
    },
    summary() {
      // The model that actually answered (a refusal fallback may differ).
      const model = messages.at(-1)?.model ?? partial?.model ?? fallbackModel;
      let input = 0;
      let output = 0;
      let cached = 0;
      let cost = 0;
      for (const m of messages) {
        const u = m.usage;
        input += u.input_tokens;
        output += u.output_tokens;
        cached += u.cache_read_input_tokens ?? 0;
        cost += costUsd(m.model, u);
        if (!isKnownModel(m.model))
          log.warn("llm.unpriced_model", { model: m.model });
      }
      if (partial) {
        input += partial.input_tokens;
        output += partial.output_tokens;
        cached += partial.cache_read_input_tokens;
        cost += costUsd(partial.model, partial);
      }
      return {
        model,
        input,
        output,
        cached,
        cost: Math.round(cost * 1e6) / 1e6,
        latencyMs: Math.round(performance.now() - startedAt),
        requestId: messages.at(-1)?.id ?? null,
        calls: messages.length,
      };
    },
  };
}

export type UsageMeter = ReturnType<typeof usageMeter>;

/**
 * Writes one llm_usage row as the user (log_llm_usage sets user_id itself).
 * Called from `finally`, so it never throws: a logging failure is logged.
 */
export async function recordUsage(
  supabase: SupabaseClient<Database>,
  args: {
    userId: string;
    feature: Feature;
    outcome: Outcome;
    meter: UsageMeter;
    promptVersion: string;
    workspaceId?: string;
  },
): Promise<void> {
  const s = args.meter.summary();
  const { error } = await supabase.rpc("log_llm_usage", {
    p_feature: args.feature,
    p_model: s.model,
    p_input_tokens: s.input,
    p_output_tokens: s.output,
    p_cached_tokens: s.cached,
    p_cost_usd: s.cost,
    p_outcome: args.outcome,
    p_latency_ms: s.latencyMs,
    p_request_id: s.requestId ?? undefined,
    p_prompt_version: args.promptVersion,
    p_workspace_id: args.workspaceId,
  });
  const fields = {
    userId: args.userId,
    feature: args.feature,
    outcome: args.outcome,
    model: s.model,
    calls: s.calls,
    // "token" in a field name is redacted by the logger backstop.
    inputTok: s.input,
    outputTok: s.output,
    cachedTok: s.cached,
    costUsd: s.cost,
    latencyMs: s.latencyMs,
  };
  if (error) log.error("llm.usage_log_failed", { ...fields, code: error.code });
  else log.info("llm.call", fields);
}

const DEFAULT_DAILY_CAP_USD = 1;

/** Per-user cap per rolling 24 hours, from LLM_DAILY_CAP_USD (plan §3.9, 2.6); $1 if unset or invalid. */
export function dailyCapUsd(): number {
  const raw = process.env.LLM_DAILY_CAP_USD;
  if (raw === undefined || raw === "") return DEFAULT_DAILY_CAP_USD;
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap < 0) {
    log.warn("llm.cap_invalid", { fallbackUsd: DEFAULT_DAILY_CAP_USD });
    return DEFAULT_DAILY_CAP_USD;
  }
  return cap;
}

export const CAP_MESSAGE =
  "You've reached your AI limit for the last 24 hours. Try again later.";

/**
 * True when the user's spend in the last 24 hours has reached the cap. A
 * rolling window, so no user setting (like time zone) can reset it (review
 * #2). Checked before each call; parallel calls can still overshoot (R-14).
 * Fails closed: if spend can't be read, the call is refused.
 */
export async function capReached(
  supabase: SupabaseClient<Database>,
  cap = dailyCapUsd(),
): Promise<boolean> {
  const { data, error } = await supabase.rpc("llm_spend_recent");
  if (error) {
    log.error("llm.cap_check_failed", { code: error.code });
    return true;
  }
  return Number(data) >= cap;
}
