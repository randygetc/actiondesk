// ADR-0003 / plan 2.5: Ask tools run with the user's client, so user B asking
// about user A's data gets nothing. Runs against local Supabase:
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

const now = new Date("2026-10-06T01:15:00Z");
let a: SupabaseClient<Database>;
let b: SupabaseClient<Database>;
let projectA: string;

const ctx = (supabase: SupabaseClient<Database>) => ({
  supabase,
  now,
  timezone: "Asia/Manila",
});

beforeAll(async () => {
  [a, b] = await Promise.all([newUser(), newUser()]);
  const { data: project, error } = await a
    .from("projects")
    .insert({ name: "Secret launch" })
    .select("id")
    .single();
  if (error) throw error;
  projectA = project.id;
  const { error: taskError } = await a.from("tasks").insert([
    {
      title: "Secret overdue task",
      project_id: projectA,
      due_at: "2026-10-01T00:00:00Z",
    },
    {
      title: "Secret future task",
      project_id: projectA,
      due_at: "2026-12-01T00:00:00Z",
    },
  ]);
  if (taskError) throw taskError;
});

describe("user A sees their own data (control)", () => {
  it("search_tasks, list_overdue and get_project_summary find A's tasks", async () => {
    const search = await searchTasks.run(ctx(a), {
      query: "Secret",
      status: null,
      project_id: null,
    });
    expect((search.result as { tasks: unknown[] }).tasks).toHaveLength(2);
    const overdue = await listOverdue.run(ctx(a), {});
    expect(
      (overdue.result as { tasks: { title: string }[] }).tasks.map(
        (t) => t.title,
      ),
    ).toEqual(["Secret overdue task"]);
    const summary = await getProjectSummary.run(ctx(a), {
      project_id: projectA,
    });
    expect(summary.result).toMatchObject({
      found: true,
      counts: { todo: 2, overdue: 1 },
    });
  });
});

describe("user B gets nothing of A's", () => {
  it("search_tasks by title finds nothing", async () => {
    const out = await searchTasks.run(ctx(b), {
      query: "Secret",
      status: null,
      project_id: null,
    });
    expect(out.result).toEqual({ tasks: [] });
  });

  it("search_tasks filtered to A's project finds nothing", async () => {
    const out = await searchTasks.run(ctx(b), {
      query: "",
      status: null,
      project_id: projectA,
    });
    expect(out.result).toEqual({ tasks: [] });
  });

  it("list_overdue shows none of A's overdue tasks", async () => {
    const out = await listOverdue.run(ctx(b), {});
    expect(out.result).toEqual({ tasks: [] });
  });

  it("get_project_summary on A's project id says not found", async () => {
    const out = await getProjectSummary.run(ctx(b), { project_id: projectA });
    expect(out.result).toEqual({ found: false });
  });

  it("create_task can't propose a task in A's project", async () => {
    const out = await createTask.run(ctx(b), {
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
    const askCtx: AskContext = { ...ctx(b), userName: "B", projects: [] };
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
