"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/redirect";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(formData.get("next")?.toString());
  // Next.js rejects Server Action POSTs whose Origin doesn't match the host,
  // and Supabase only redirects to URLs on its allow-list.
  const origin = (await headers()).get("origin");
  if (!origin) redirect("/login?error=auth");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    log.warn("auth.oauth_start_failed", {
      provider: "google",
      status: error?.status,
    });
    redirect("/login?error=auth");
  }
  redirect(data.url);
}
