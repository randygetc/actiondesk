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
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
  },
});
