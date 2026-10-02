import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Same env as the app (.env.local), so e2e helpers can reach local Supabase.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const baseURL = "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One dev server serves every worker. At the local default (half the
  // cores, 7 here) tests time out at random; 4 is stable. CI keeps its
  // default (1 on a 2-core runner).
  workers: process.env.CI ? undefined : 4,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /realtime\.spec\.ts/,
    },
    // Realtime tests assert latency (2 s, 5 s). Next to other tests on the one
    // dev server they time out at random, so they run after everything else,
    // one at a time, and measure an idle server.
    {
      name: "realtime",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /realtime\.spec\.ts/,
      dependencies: ["chromium"],
      fullyParallel: false,
    },
  ],
  webServer: {
    command: "npm run dev",
    // Extraction uses the fake model in e2e (R-21). A reused local dev server
    // doesn't get this, so capture tests check data-llm and skip without it.
    env: { LLM_FAKE: "1" },
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
  },
});
