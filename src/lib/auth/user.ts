import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * For Server Components: the signed-in user and a user-scoped client, or a
 * redirect to /login. Uses getUser(), which verifies the token with Supabase
 * Auth (CLAUDE.md rule 5).
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}
