// Weekly digest Edge Function (step 3.6, docs/plan.md §4.6).
//
// POST {"mode":"scheduled"}            from pg_cron (service key only): every
//                                      recipient due now (digest_due), each
//                                      recorded in digest_runs so a retry
//                                      never resends.
// POST {"mode":"test","workspace_id"}  from the "Send test digest now" button
//                                      with the user's JWT: owners only, sent
//                                      to the caller, counts toward their cap.
//
// ADR-0003: the admin client is allowed here; every query is scoped to one
// workspace (digest_data). Model output is validated with Zod and escaped in
// the email (rule 7). Logs carry ids and counts only (rule 12).

import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/deno";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  DIGEST_PROMPT_VERSION,
  DIGEST_SYSTEM,
  DIGEST_TOOL,
  digestCostUsd,
  digestDataSchema,
  digestSchema,
  digestUserMessage,
  isEmptyWeek,
  renderDigestEmail,
} from "../_shared/digest.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const MODEL = "claude-sonnet-5-5";
const TIME_BUDGET_MS = 100_000; // stop early; the next hourly run resumes

// Step 3.8: errors go to Sentry when the function has a SENTRY_DSN secret.
// No personal data: ids only, never task text or emails.
if (env("SENTRY_DSN")) {
  Sentry.init({
    dsn: env("SENTRY_DSN"),
    environment: env("SENTRY_ENVIRONMENT") || "development",
    tracesSampleRate: 0,
  });
}

function log(
  event: string,
  fields: Record<string, string | number | boolean | null> = {},
) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event,
      ...fields,
    }),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Recipient = {
  workspace_id: string;
  user_id: string;
  email: string;
  timezone: string;
  week_start: string;
};

class DigestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function sendEmail(m: {
  to: string;
  subject: string;
  html: string;
  text: string;
  key: string;
}) {
  const from = env("DIGEST_FROM") || "ActionDesk <digest@actiondesk.local>";
  if (env("EMAIL_TRANSPORT") === "resend") {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        // A retried send of the same digest is dropped by Resend.
        "Idempotency-Key": m.key,
      },
      body: JSON.stringify({
        from,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
      }),
    });
    if (!r.ok) throw new DigestError(`email_${r.status}`);
    return;
  }
  // Local and CI: Mailpit (Supabase's test inbox).
  const r = await fetch(
    `${env("MAILPIT_URL") || "http://supabase_inbucket_actiondesk:8025"}/api/v1/send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: from.replace(/^.*<|>$/g, ""), Name: "ActionDesk" },
        To: [{ Email: m.to }],
        Subject: m.subject,
        Text: m.text,
        HTML: m.html,
      }),
    },
  );
  if (!r.ok) throw new DigestError(`email_${r.status}`);
}

/** Builds and sends one recipient's digest. Returns "sent" or "skipped" (empty week). */
async function sendDigest(
  admin: SupabaseClient,
  r: Recipient,
  subjectPrefix = "",
  now?: string,
): Promise<"sent" | "skipped"> {
  const { data: raw, error } = await admin.rpc("digest_data", {
    p_workspace_id: r.workspace_id,
    p_tz: r.timezone,
    ...(now ? { p_now: now } : {}),
  });
  if (error) throw new DigestError(`data_${error.code}`);
  const data = digestDataSchema.parse(raw);
  if (isEmptyWeek(data)) return "skipped";

  const started = Date.now();
  const anthropic = new Anthropic({
    apiKey: env("ANTHROPIC_API_KEY"),
    timeout: 30_000,
    maxRetries: 1,
  });
  const tag = `data-${crypto.randomUUID().slice(0, 8)}`;
  let outcome: "ok" | "invalid_output" | "error" = "error";
  let message: Anthropic.Message | undefined;
  try {
    message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2_000,
      system: DIGEST_SYSTEM,
      tools: [DIGEST_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "auto" },
      output_config: { effort: "low" },
      messages: [
        { role: "user", content: digestUserMessage(data, r.week_start, tag) },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const call = message.content.find(
      (b) => b.type === "tool_use" && b.name === DIGEST_TOOL.name,
    );
    const digest = digestSchema.safeParse(
      call && "input" in call ? call.input : undefined,
    );
    if (!digest.success) {
      outcome = "invalid_output";
      throw new DigestError("invalid_output");
    }
    outcome = "ok";

    const email = renderDigestEmail(
      data,
      digest.data,
      r.week_start,
      env("APP_URL") || "http://127.0.0.1:3000",
    );
    await sendEmail({
      to: r.email,
      subject: subjectPrefix + email.subject,
      html: email.html,
      text: email.text,
      key: `digest/${r.workspace_id}/${r.user_id}/${r.week_start}${subjectPrefix ? "/test" : ""}`,
    });
    return "sent";
  } finally {
    // Every model call is logged, failures too (usage counts from the API only).
    if (message || outcome !== "ok") {
      const u = message?.usage;
      await admin.from("llm_usage").insert({
        user_id: r.user_id,
        workspace_id: r.workspace_id,
        feature: "digest",
        model: message?.model ?? MODEL,
        input_tokens: u?.input_tokens ?? 0,
        output_tokens: u?.output_tokens ?? 0,
        cached_tokens: u?.cache_read_input_tokens ?? 0,
        cost_usd: u ? digestCostUsd(message!.model, u) : 0,
        outcome,
        latency_ms: Date.now() - started,
        request_id: message?.id ?? null,
        prompt_version: DIGEST_PROMPT_VERSION,
      });
    }
  }
}

async function runScheduled(admin: SupabaseClient, now?: string) {
  const started = Date.now();
  const { data: due, error } = await admin.rpc(
    "digest_due",
    now ? { p_now: now } : {},
  );
  if (error) throw new DigestError(`due_${error.code}`);
  const counts = {
    due: due.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };

  for (const r of due as Recipient[]) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      counts.deferred++;
      continue;
    }
    const key = {
      workspace_id: r.workspace_id,
      user_id: r.user_id,
      week_start: r.week_start,
    };
    const { data: prev } = await admin
      .from("digest_runs")
      .select("attempts")
      .match(key)
      .maybeSingle();
    await admin
      .from("digest_runs")
      .upsert(
        { ...key, status: "pending", attempts: (prev?.attempts ?? 0) + 1 },
        { onConflict: "workspace_id,user_id,week_start" },
      );
    try {
      const status = await sendDigest(admin, r, "", now);
      await admin
        .from("digest_runs")
        .update({
          status,
          sent_at: status === "sent" ? new Date().toISOString() : null,
          error_code: null,
        })
        .match(key);
      counts[status]++;
    } catch (e) {
      const code =
        e instanceof DigestError
          ? e.code
          : e instanceof Error
            ? e.name
            : "error";
      await admin
        .from("digest_runs")
        .update({ status: "failed", error_code: code.slice(0, 100) })
        .match(key);
      counts.failed++;
      log("digest.failed", {
        workspaceId: r.workspace_id,
        userId: r.user_id,
        code,
      });
      Sentry.captureException(e, {
        tags: { feature: "digest", code },
        extra: { workspaceId: r.workspace_id, userId: r.user_id },
      });
    }
  }
  log("digest.batch", counts);
  return counts;
}

async function runTest(
  req: Request,
  admin: SupabaseClient,
  workspaceId: string,
) {
  const user = createClient(SUPABASE_URL, env("SUPABASE_ANON_KEY"), {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
    auth: { persistSession: false },
  });
  const { data: auth } = await user.auth.getUser();
  if (!auth.user?.email) return json({ error: "unauthorized" }, 401);
  // Checked with the caller's own session (RLS), not the admin client.
  const { data: isOwner } = await user.rpc("is_member", {
    p_workspace_id: workspaceId,
    p_min_role: "owner",
  });
  if (!isOwner) return json({ error: "forbidden" }, 403);
  const { data: spend } = await user.rpc("llm_spend_recent");
  const cap = Number(env("LLM_DAILY_CAP_USD") || "1");
  if (Number(spend) >= cap) return json({ error: "capped" }, 429);

  const { data: profile } = await admin
    .from("profiles")
    .select("timezone")
    .eq("id", auth.user.id)
    .single();
  const timezone = profile?.timezone ?? "UTC";
  const weekStart = new Date().toLocaleDateString("en-CA", {
    timeZone: timezone,
  });
  const status = await sendDigest(
    admin,
    {
      workspace_id: workspaceId,
      user_id: auth.user.id,
      email: auth.user.email,
      timezone,
      week_start: weekStart,
    },
    "[Test] ",
  );
  log("digest.test", { workspaceId, userId: auth.user.id, status });
  return json({ status });
}

const bodySchema = z.discriminatedUnion("mode", [
  // `now` (service key only) lets tests run "Monday 08:05" on any day.
  z.object({
    mode: z.literal("scheduled"),
    now: z.iso.datetime({ offset: true }).optional(),
  }),
  z.object({ mode: z.literal("test"), workspace_id: z.uuid() }),
]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "bad_request" }, 400);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  try {
    if (body.data.mode === "scheduled") {
      // Only the cron job holds the service key.
      if (req.headers.get("Authorization") !== `Bearer ${SERVICE_KEY}`)
        return json({ error: "unauthorized" }, 401);
      const result = await runScheduled(admin, body.data.now);
      await Sentry.flush(2_000); // per-recipient failures were captured in the batch
      return json(result);
    }
    return await runTest(req, admin, body.data.workspace_id);
  } catch (e) {
    const code = e instanceof DigestError ? e.code : "error";
    log("digest.error", { code });
    Sentry.captureException(e, { tags: { feature: "digest", code } });
    await Sentry.flush(2_000);
    return json({ error: code }, code === "invalid_output" ? 502 : 500);
  }
});
