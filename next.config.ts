import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: Next 16 blocks dev resources (HMR, dev chunks) for hosts other
  // than localhost. We use 127.0.0.1 (Supabase redirect URLs, Playwright), and
  // without this the page never hydrates in dev.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
