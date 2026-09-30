// R-10: complete_task() must create exactly one next occurrence even when two
// completions race. Runs against local Supabase (`npm run test:db`).
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { beforeAll, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: false } },
);

let workspaceId: string;

beforeAll(async () => {
  const { data, error } = await supabase.auth.signUp({
    email: `db-${randomUUID()}@example.com`,
    password: randomUUID(),
  });
  if (error) throw error;
  // Every new user has a Personal workspace (step 3.2).
  const { data: ws, error: wsError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", data.user!.id)
    .single();
  if (wsError) throw wsError;
  workspaceId = ws.workspace_id;
});

it("two concurrent completions create exactly one next occurrence", async () => {
  for (let i = 0; i < 10; i++) {
    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        workspace_id: workspaceId,
        title: `Race ${i}`,
        due_at: "2026-10-06T16:00:00Z",
        recurrence: "FREQ=DAILY",
        recurrence_tz: "America/Los_Angeles",
      })
      .select("id")
      .single();
    if (error) throw error;

    const next = "2026-10-07T16:00:00Z";
    const results = await Promise.all([
      supabase.rpc("complete_task", {
        p_task_id: task.id,
        p_next_due_at: next,
      }),
      supabase.rpc("complete_task", {
        p_task_id: task.id,
        p_next_due_at: next,
      }),
    ]);
    for (const r of results) expect(r.error).toBeNull();
    // Exactly one of the two calls created the occurrence.
    expect(results.filter((r) => r.data !== null)).toHaveLength(1);

    const { data: series } = await supabase
      .from("tasks")
      .select("status, due_at")
      .eq("series_id", task.id)
      .order("due_at");
    expect(series).toEqual([
      { status: "done", due_at: "2026-10-06T16:00:00+00:00" },
      { status: "todo", due_at: "2026-10-07T16:00:00+00:00" },
    ]);
  }
});
