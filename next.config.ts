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

export default nextConfig;
