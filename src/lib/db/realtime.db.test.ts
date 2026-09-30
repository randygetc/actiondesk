// Step 3.4: workspace broadcasts reach members only (RLS on realtime.messages)
// and carry no task content. Runs against local Supabase and its Realtime
// server: npm run test:db
import { randomUUID } from "node:crypto";

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

async function newUser() {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const email = `db-${randomUUID()}@example.com`;
  const { error } = await client.auth.signUp({ email, password: randomUUID() });
  if (error) throw error;
  return { client, email };
}

type Listener = {
  channel: RealtimeChannel;
  status: string;
  messages: { event: string; payload: Record<string, unknown> }[];
};

/** Joins a private channel as this user; resolves with the join outcome. */
async function listen(
  client: SupabaseClient<Database>,
  topic: string,
): Promise<Listener> {
  await client.realtime.setAuth();
  const messages: Listener["messages"] = [];
  const channel = client
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "*" }, (m) =>
      messages.push({
        event: m.event,
        payload: m.payload as Record<string, unknown>,
      }),
    );
  const status = await new Promise<string>((resolve) => {
    channel.subscribe((s) => {
      if (s !== "CLOSED") resolve(s);
    });
    setTimeout(() => resolve("TIMED_OUT"), 5_000);
  });
  return { channel, status, messages };
}

const waitFor = async (check: () => boolean, ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
};

let owner: SupabaseClient<Database>;
let member: Listener;
let outsider: Listener;
let workspaceId: string;
const clients: SupabaseClient<Database>[] = [];

beforeAll(async () => {
  const a = await newUser();
  const b = await newUser();
  const c = await newUser();
  clients.push(a.client, b.client, c.client);
  owner = a.client;

  const { data: ws, error } = await owner.rpc("create_workspace", {
    p_name: "Live",
  });
  if (error) throw error;
  workspaceId = ws;
  const { data: token, error: inviteError } = await owner.rpc("create_invite", {
    p_workspace_id: workspaceId,
    p_email: b.email,
    p_role: "viewer",
  });
  if (inviteError) throw inviteError;
  const { error: acceptError } = await b.client.rpc("accept_invite", {
    p_token: token,
  });
  if (acceptError) throw acceptError;

  const topic = `workspace:${workspaceId}`;
  [member, outsider] = await Promise.all([
    listen(b.client, topic),
    listen(c.client, topic),
  ]);
}, 30_000);

afterAll(async () => {
  for (const c of clients) await c.removeAllChannels();
});

it("a member (even a viewer) joins the workspace channel; an outsider can't", () => {
  expect(member.status).toBe("SUBSCRIBED");
  expect(outsider.status).not.toBe("SUBSCRIBED");
});

it("a task change reaches the member within 2 s and nothing reaches the outsider", async () => {
  const started = Date.now();
  const { data: task, error } = await owner
    .from("tasks")
    .insert({ workspace_id: workspaceId, title: "Secret plan" })
    .select("id")
    .single();
  if (error) throw error;

  expect(await waitFor(() => member.messages.length > 0, 2_000)).toBe(true);
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(member.messages[0]).toEqual({
    event: "tasks_changed",
    // Only what changed, never the title: the browser re-reads through RLS.
    payload: { table: "tasks", op: "insert", id: task.id },
  });

  // Give the outsider the same chance to (wrongly) receive it.
  await new Promise((r) => setTimeout(r, 1_500));
  expect(outsider.messages).toEqual([]);
});
