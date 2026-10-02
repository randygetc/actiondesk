// Hourly attachment cleanup (R-20, D-21). Called by pg_cron with CRON_SECRET
// (invoke_attachment_cleanup); nothing else may call it.
//
// ADR-0003: the admin client is allowed here. It touches only the attachments
// table and bucket, by id and path, and never reads file contents. Logs carry
// counts only (rule 12).

import * as Sentry from "@sentry/deno";
import { createClient } from "@supabase/supabase-js";

import {
  cleanupAttachments,
  type CleanupStore,
} from "../_shared/attachment-cleanup.ts";
import { isCronCall } from "../_shared/cron-auth.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = "attachments";

if (env("SENTRY_DSN")) {
  Sentry.init({
    dsn: env("SENTRY_DSN"),
    environment: env("SENTRY_ENVIRONMENT") || "development",
    tracesSampleRate: 0,
  });
}

function log(
  level: "info" | "error",
  event: string,
  fields: Record<string, string | number | boolean | null> = {},
) {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!isCronCall(req.headers.get("Authorization"), env("CRON_SECRET")))
    return json({ error: "unauthorized" }, 401);

  const admin = createClient(env("SUPABASE_URL"), SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const store: CleanupStore = {
    async expired(cutoff, limit) {
      const { data, error } = await admin
        .from("attachments")
        .select("id, storage_path")
        .lt("created_at", cutoff)
        .order("created_at")
        .limit(limit);
      if (error) throw new Error(`select_${error.code}`);
      return data;
    },
    async removeObjects(paths) {
      const { error } = await admin.storage.from(BUCKET).remove(paths);
      return { ok: !error };
    },
    async deleteRows(ids) {
      const { error } = await admin.from("attachments").delete().in("id", ids);
      return { ok: !error };
    },
  };

  try {
    const result = await cleanupAttachments(store, new Date());
    log(result.failedAt ? "error" : "info", "attachments.cleanup", result);
    if (result.failedAt) {
      Sentry.captureMessage("attachments.cleanup_failed", {
        level: "error",
        tags: { feature: "attachment-cleanup", failedAt: result.failedAt },
        extra: { deleted: result.deleted },
      });
      await Sentry.flush(2_000);
    }
    return json(result, result.failedAt ? 500 : 200);
  } catch (e) {
    const code = e instanceof Error ? e.message.slice(0, 60) : "error";
    log("error", "attachments.cleanup_error", { code });
    Sentry.captureException(e, { tags: { feature: "attachment-cleanup" } });
    await Sentry.flush(2_000);
    return json({ error: "cleanup_failed" }, 500);
  }
});
