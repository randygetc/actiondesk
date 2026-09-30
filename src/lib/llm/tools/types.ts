import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { Database } from "@/lib/database.types";
import type { CreateTaskProposal } from "@/lib/validation/ask";

import type { LlmTool } from "../client";

/**
 * Every tool gets the request's user-scoped client, so RLS decides what it can
 * see (ADR-0003, R4). Tools never import the admin client (depcruise R3).
 */
export type ToolContext = {
  supabase: SupabaseClient<Database>;
  now: Date;
  timezone: string;
};

export type ToolOutput = {
  /** JSON sent back to the model as the tool result. */
  result: unknown;
  /** Set only by create_task: shown to the user, never executed here. */
  proposal?: CreateTaskProposal;
};

export type AskTool<S extends z.ZodType = z.ZodType> = {
  definition: LlmTool;
  input: S;
  /** Short text for the UI chip, e.g. `Searched tasks for "deck"`. */
  describe: (input: z.output<S>) => string;
  run: (ctx: ToolContext, input: z.output<S>) => Promise<ToolOutput>;
};

export function defineTool<S extends z.ZodType>(tool: AskTool<S>): AskTool<S> {
  return tool;
}
