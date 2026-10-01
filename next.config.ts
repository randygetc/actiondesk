// Sentry v11: the build helper lives in its own entry point.
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: Next 16 blocks dev resources (HMR, dev chunks) for hosts other
  // than localhost. We use 127.0.0.1 (Supabase redirect URLs, Playwright), and
  // without this the page never hydrates in dev.
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      // Attachments are up to 4 MB plus multipart overhead, which is what
      // Vercel's 4.5 MB request body cap allows (R-22, D-22). Every other
      // action is small, so this is the only reason to raise the 1 MB default.
      bodySizeLimit: "4.5mb",
    },
  },
};

// Step 3.8: Sentry build integration. Source maps are uploaded (for readable
// stack traces) only when SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are
// set; otherwise the build is unchanged apart from the SDK.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
