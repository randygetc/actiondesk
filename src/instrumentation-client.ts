import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/observability/sentry-options";

// Step 3.8: Sentry in the browser. No session replay (it would record task text).
Sentry.init(sentryOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
