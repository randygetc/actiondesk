import { randomUUID } from "node:crypto";

import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

/** A server client whose cookies land in a jar we can copy into a browser. */
function clientWithJar() {
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
  return { supabase, jar };
}

async function copyCookies(
  context: BrowserContext,
  baseURL: string,
  jar: ReturnType<typeof clientWithJar>["jar"],
) {
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
}

/**
 * D-8: e2e tests sign in with email/password, which is enabled only in local
 * and CI Supabase. Signs up a fresh user, then puts the session cookies that
 * @supabase/ssr would write into the browser context.
 */
export async function signInAsNewUser(
  context: BrowserContext,
  baseURL: string,
) {
  const { supabase, jar } = clientWithJar();
  const email = `e2e-${randomUUID()}@example.com`;
  const password = randomUUID();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session)
    throw new Error(`e2e sign-up failed: ${error?.message}`);
  await copyCookies(context, baseURL, jar);
  // `supabase` is signed in as the same user, for setting up test data.
  return { userId: data.session.user.id, email, password, supabase };
}

/** A fresh password sign-in (an aal1 session, even if the user has MFA). */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  email: string,
  password: string,
) {
  const { supabase, jar } = clientWithJar();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`e2e sign-in failed: ${error.message}`);
  await copyCookies(context, baseURL, jar);
}
