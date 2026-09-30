// ADR-0003 / plan 2.5: Ask tools run with the user's client, so user B asking
// about user A's data gets nothing, even when B's context names A's workspace
// (a forged workspace cookie, R-28, step 3.2). Runs against local Supabase:
// npm run test:db
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

import { ask, type AskContext } from "../ask";
import type { LlmClient, LlmContentBlock, LlmMessage } from "../client";
import {
  createTask,
  getProjectSummary,
  listOverdue,
  searchTasks,
} from "./tasks";

async function newUser(): Promise<{
  client: SupabaseClient<Database>;
  workspaceId: string;
}> {
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
  const { data: ws, error: wsError } = await client
    .from("workspace_members")
    .select("workspace_id")
    .single();
  if (wsError) throw wsError;
  return { client, workspaceId: ws.workspace_id };
}

const now = new Date("2026-10-06T01:15:00Z");
let a: SupabaseClient<Database>;
let b: SupabaseClient<Database>;
let wsA: string;
let wsB: string;
let projectA: string;

const ctx = (supabase: SupabaseClient<Database>, workspaceId: string) => ({
  supabase,
  workspaceId,
  now,
  timezone: "Asia/Manila",
});

beforeAll(async () => {
  const [ua, ub] = await Promise.all([newUser(), newUser()]);
  [a, wsA, b, wsB] = [ua.client, ua.workspaceId, ub.client, ub.workspaceId];
  const { data: project, error } = await a
    .from("projects")
    .insert({ name: "Secret launch", workspace_id: wsA })
    .select("id")
    .single();
  if (error) throw error;
  projectA = project.id;
  const { error: taskError } = await a.from("tasks").insert([
    {
      workspace_id: wsA,
      title: "Secret overdue task",
      project_id: projectA,
      due_at: "2026-10-01T00:00:00Z",
    },
    {
      workspace_id: wsA,
      title: "Secret future task",
      project_id: projectA,
      due_at: "2026-12-01T00:00:00Z",
    },
  ]);
  if (taskError) throw taskError;
});

describe("user A sees their own data (control)", () => {
  it("search_tasks, list_overdue and get_project_summary find A's tasks", async () => {
    const search = await searchTasks.run(ctx(a, wsA), {
      query: "Secret",
      status: null,
      project_id: null,
    });
    expect((search.result as { tasks: unknown[] }).tasks).toHaveLength(2);
    const overdue = await listOverdue.run(ctx(a, wsA), {});
    expect(
      (overdue.result as { tasks: { title: string }[] }).tasks.map(
        (t) => t.title,
      ),
    ).toEqual(["Secret overdue task"]);
    const summary = await getProjectSummary.run(ctx(a, wsA), {
      project_id: projectA,
    });
    expect(summary.result).toMatchObject({
      found: true,
      counts: { todo: 2, overdue: 1 },
    });
  });
});

describe("user B with a forged workspace (B's session, A's workspace id)", () => {
  it("every read tool still returns nothing: RLS, not the filter, decides", async () => {
    const forged = ctx(b, wsA);
    expect(
      (
        await searchTasks.run(forged, {
          query: "",
          status: null,
          project_id: null,
        })
      ).result,
    ).toEqual({ tasks: [] });
    expect((await listOverdue.run(forged, {})).result).toEqual({ tasks: [] });
    expect(
      (await getProjectSummary.run(forged, { project_id: projectA })).result,
    ).toEqual({
      found: false,
    });
  });

  it("a proposal into A's workspace can't be saved by B", async () => {
    const { error } = await b
      .from("tasks")
      .insert({ workspace_id: wsA, title: "Forged" });
    expect(error?.code).toBe("42501");
  });
});

describe("user B gets nothing of A's", () => {
  it("search_tasks by title finds nothing", async () => {
    const out = await searchTasks.run(ctx(b, wsB), {
      query: "Secret",
      status: null,
      project_id: null,
    });
    expect(out.result).toEqual({ tasks: [] });
  });

  it("search_tasks filtered to A's project finds nothing", async () => {
    const out = await searchTasks.run(ctx(b, wsB), {
      query: "",
      status: null,
      project_id: projectA,
    });
    expect(out.result).toEqual({ tasks: [] });
  });

  it("list_overdue shows none of A's overdue tasks", async () => {
    const out = await listOverdue.run(ctx(b, wsB), {});
    expect(out.result).toEqual({ tasks: [] });
  });

  it("get_project_summary on A's project id says not found", async () => {
    const out = await getProjectSummary.run(ctx(b, wsB), {
      project_id: projectA,
    });
    expect(out.result).toEqual({ found: false });
  });

  it("create_task can't propose a task in A's project", async () => {
    const out = await createTask.run(ctx(b, wsB), {
      title: "Sneaky",
      due_date: null,
      due_time: null,
      project_id: projectA,
      priority: "normal",
    });
    expect(out.proposal).toBeUndefined();
    expect(out.result).toMatchObject({ proposed: false });
  });

  it("through the full ask loop, B asking about A's project gets nothing", async () => {
    // A scripted model that asks for A's project, as a prompt injection might.
    const results: string[] = [];
    let turn = 0;
    const client: LlmClient = {
      async *stream(request) {
        const last = request.messages.at(-1)!.content;
        if (Array.isArray(last))
          for (const r of last)
            if (r.type === "tool_result") results.push(String(r.content));
        const content = (
          turn++ === 0
            ? [
                {
                  type: "tool_use",
                  id: "t1",
                  name: "get_project_summary",
                  input: { project_id: projectA },
                },
                {
                  type: "tool_use",
                  id: "t2",
                  name: "search_tasks",
                  input: { query: "Secret", status: null, project_id: null },
                },
              ]
            : [{ type: "text", text: "I couldn't find that.", citations: null }]
        ) as LlmContentBlock[];
        const message = {
          id: `m${turn}`,
          model: "fake",
          content,
          stop_reason: turn === 1 ? "tool_use" : "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        } as unknown as LlmMessage;
        yield { type: "message", message };
      },
    };
    const askCtx: AskContext = { ...ctx(b, wsB), userName: "B", projects: [] };
    const events = [];
    for await (const e of ask(client, askCtx, {
      history: [],
      question: "Summarize Secret launch",
    }))
      events.push(e);
    expect(results).toEqual(['{"found":false}', '{"tasks":[]}']);
    expect(events.filter((e) => e.type === "proposal")).toEqual([]);
  });
});
