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
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    // Extraction uses the fake model in e2e (R-21). A reused local dev server
    // doesn't get this, so capture tests check data-llm and skip without it.
    env: { LLM_FAKE: "1" },
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
  },
});
