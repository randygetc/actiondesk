import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: Next 16 blocks dev resources (HMR, dev chunks) for hosts other
  // than localhost. We use 127.0.0.1 (Supabase redirect URLs, Playwright), and
  // without this the page never hydrates in dev.
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      // Attachments are up to 10 MB (plan §3.6), plus multipart overhead.
      // Vercel caps function request bodies at 4.5 MB regardless (R-22).
      bodySizeLimit: "11mb",
    },
    // The proxy (src/proxy.ts) buffers request bodies too, and cuts them at
    // 10 MB by default, which truncated uploads just over the limit.
    proxyClientMaxBodySize: "11mb",
  },
};

export default nextConfig;
