import type { NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

/**
 * Relative redirect: the browser stays on the host it used. (Next normalizes
 * request.url's host, e.g. 127.0.0.1 → localhost in dev, which would drop the
 * session cookie.) Cookies set via next/headers are merged into this response.
 */
function redirectTo(path: string) {
  return new Response(null, { status: 303, headers: { Location: path } });
}

/** OAuth return: exchange the PKCE code for a session, then go to `next`. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectTo(next);
    log.warn("auth.code_exchange_failed", { status: error.status });
  }

  return redirectTo("/login?error=auth");
}
