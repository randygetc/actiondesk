import { randomUUID } from "node:crypto";

import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

/**
 * D-8: e2e tests sign in with email/password, which is enabled only in local
 * and CI Supabase. Signs up a fresh user, then puts the session cookies that
 * @supabase/ssr would write into the browser context.
 */
export async function signInAsNewUser(
  context: BrowserContext,
  baseURL: string,
) {
  const jar = new Map<
    string,
    { value: string; options: Record<string, unknown> }
  >();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies)
            jar.set(name, { value, options });
        },
      },
    },
  );

  const email = `e2e-${randomUUID()}@example.com`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password: randomUUID(),
  });
  if (error || !data.session)
    throw new Error(`e2e sign-up failed: ${error?.message}`);

  const { hostname } = new URL(baseURL);
  await context.addCookies(
    [...jar]
      .filter(([, c]) => c.value !== "")
      .map(([name, c]) => ({
        name,
        value: c.value,
        domain: hostname,
        path: "/",
        sameSite: "Lax" as const,
      })),
  );
  // `supabase` is signed in as the same user, for setting up test data.
  return { userId: data.session.user.id, email, supabase };
}
