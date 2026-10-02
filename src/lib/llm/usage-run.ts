import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import type { Database } from "@/lib/database.types";

import { recordUsage, usageMeter } from "./usage";

type Feature = Database["public"]["Enums"]["llm_feature"];
type Outcome = Database["public"]["Enums"]["llm_outcome"];

/**
 * Usage accounting for one streaming LLM action. Call it in the action, before
 * returning the generator.
 *
 * When the browser disconnects, React stops reading the stream but doesn't
 * close the generator, so its `finally` may never run (found at 2.8; this
 * corrects the 2.1 spike's result d). `after()` runs once the response is
 * over either way: if the generator hasn't logged by then, it stops the API
 * stream and records the partial usage as `aborted` (security review #1).
 */
export function usageRun(args: {
  supabase: SupabaseClient<Database>;
  userId: string;
  feature: Feature;
  model: string;
  promptVersion: string;
  /** For reporting (D-25); the cap stays per user. */
  workspaceId?: string;
}) {
  const meter = usageMeter(args.model);
  const controller = new AbortController();
  let outcome: Outcome = "aborted";
  let logged = false;

  async function finish() {
    if (logged) return;
    logged = true; // set before any await, so only one path records
    controller.abort();
    await recordUsage(args.supabase, {
      userId: args.userId,
      feature: args.feature,
      outcome,
      meter,
      promptVersion: args.promptVersion,
      workspaceId: args.workspaceId,
    });
  }

  after(finish);

  return {
    meter,
    signal: controller.signal,
    setOutcome(o: Outcome) {
      outcome = o;
    },
    /** The outcome so far; "aborted" until the generator sets one. */
    outcome: () => outcome,
    /** Called from the generator's `finally`; a no-op if after() got there first. */
    finish,
  };
}

export type UsageRun = ReturnType<typeof usageRun>;
