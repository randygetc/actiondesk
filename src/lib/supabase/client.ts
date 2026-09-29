import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Reads and Realtime only; mutations go through
 * Server Actions (ADR-0004).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
