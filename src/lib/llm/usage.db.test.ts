// The cap reads the user's own spend in the last 24 hours (llm_spend_recent, RLS).
// Runs against local Supabase: npm run test:db
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

import { capReached } from "./usage";

async function newUser(): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await client.auth.signUp({
    email: `db-${randomUUID()}@example.com`,
    password: randomUUID(),
  });
  if (error) throw error;
  return client;
}

let spender: SupabaseClient<Database>;
let other: SupabaseClient<Database>;

beforeAll(async () => {
  [spender, other] = await Promise.all([newUser(), newUser()]);
  const { error } = await spender.rpc("log_llm_usage", {
    p_feature: "extract",
    p_model: "claude-sonnet-5-5",
    p_input_tokens: 1000,
    p_output_tokens: 100,
    p_cached_tokens: 0,
    p_cost_usd: 0.3,
    p_outcome: "ok",
    p_latency_ms: 100,
  });
  if (error) throw error;
});

it("is reached once the last 24 hours of own spend meets the cap", async () => {
  expect(await capReached(spender, 0.5)).toBe(false);
  expect(await capReached(spender, 0.3)).toBe(true);
});

it("counts only the user's own spend", async () => {
  expect(await capReached(other, 0.3)).toBe(false);
});

it("fails closed when spend can't be read", async () => {
  // A client with no session can't call llm_spend_recent (42501).
  const anon = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  expect(await capReached(anon, 100)).toBe(true);
});
