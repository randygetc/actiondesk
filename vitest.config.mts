import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // server-only throws outside the react-server condition (plan R-6).
      // Never remove the import from a module to make a test pass.
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "src/**/*.test.{ts,tsx}",
            "evals/**/*.test.ts",
            "supabase/functions/_shared/**/*.test.ts",
          ],
          exclude: ["src/**/*.db.test.ts"],
          environment: "node",
        },
      },
      {
        // Runs against local Supabase (`supabase start`): npm run test:db
        extends: true,
        test: {
          name: "db",
          include: ["src/**/*.db.test.ts"],
          environment: "node",
          setupFiles: ["test/load-env.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "eval",
          include: ["evals/**/*.eval.ts"],
          environment: "node",
          // Live mode (EVAL_LIVE=1) reads ANTHROPIC_API_KEY from .env.local.
          setupFiles: ["test/load-env.ts"],
        },
      },
    ],
  },
});
