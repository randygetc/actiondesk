"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort error page for crashes in the root layout (reported to Sentry). */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", padding: 24 }}>
        <h1>Something went wrong</h1>
        <p>The error was reported. Reload the page to try again.</p>
        {error.digest ? (
          <p style={{ color: "#666" }}>Reference: {error.digest}</p>
        ) : null}
      </body>
    </html>
  );
}
