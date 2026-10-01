import type { ErrorEvent } from "@sentry/nextjs";

// Step 3.8: one Sentry configuration for the browser, server and edge
// runtimes. Without NEXT_PUBLIC_SENTRY_DSN it does nothing.
//
// Privacy (rule 12): no personal data (sendDefaultPii off), no request bodies,
// cookies or auth headers, no IP. Errors carry ids, never note or task text.

/** Removes anything from an event that could hold user content or secrets. */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    const requestId = event.request.headers?.["x-request-id"];
    event.request.headers = requestId ? { "x-request-id": requestId } : {};
    if (requestId) event.tags = { ...event.tags, requestId };
  }
  if (event.user)
    event.user = event.user.id ? { id: event.user.id } : undefined;
  return event;
}

export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
};
