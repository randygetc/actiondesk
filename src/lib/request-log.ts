import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import * as Sentry from "@sentry/nextjs";

import { log, redact, type LogFields, type Logger } from "./log";

// Step 3.8: one logger, with the request's context on every line.

/** Set by the proxy on every request (and returned to the client). */
export const REQUEST_ID_HEADER = "x-request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The logger bound to this request: `requestId` from the proxy, and the
 * current `workspaceId` from the workspace cookie (a preference, so only a
 * well-formed id is logged; authorization never reads it from here). Call
 * sites still add `userId`, `feature`, `latencyMs` and their own ids.
 * Memoized per request in Server Components; recomputed (cheaply) in actions.
 */
export const requestLog = cache(async (): Promise<Logger> => {
  let bound: LogFields = {};
  try {
    const [h, c] = await Promise.all([headers(), cookies()]);
    const ws = c.get("ws")?.value;
    bound = {
      requestId: h.get(REQUEST_ID_HEADER),
      workspaceId: ws && UUID.test(ws) ? ws : null,
    };
  } catch {
    // Outside a request (scripts, tests): no request ids to bind.
  }
  return toSentry(log.with(bound), bound);
});

/**
 * Errors that actions catch and log (most of them: the user gets a friendly
 * message) would never reach Sentry otherwise. Report them too, with the same
 * redacted fields as the log line.
 */
export function toSentry(logger: Logger, bound: LogFields = {}): Logger {
  return {
    ...logger,
    error: (event, fields) => {
      logger.error(event, fields);
      const all = redact({ ...bound, ...fields });
      Sentry.captureMessage(event, {
        level: "error",
        tags: {
          event,
          requestId: String(all.requestId ?? ""),
          workspaceId: String(all.workspaceId ?? ""),
        },
        extra: all,
      });
    },
    with: (more) => toSentry(logger.with(more), { ...bound, ...more }),
  };
}
