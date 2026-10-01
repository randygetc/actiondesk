import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/observability/sentry-options";

// Step 3.8: Sentry for the Node and edge server runtimes.
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    Sentry.init(sentryOptions);
  }
}

// Errors thrown while rendering, in route handlers and in Server Actions.
export const onRequestError = Sentry.captureRequestError;
