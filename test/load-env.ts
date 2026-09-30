// Loads .env.local (local Supabase URL and publishable key) for db tests.
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
