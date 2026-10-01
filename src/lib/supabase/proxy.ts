import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";

// The proxy runs before any page; keep in step with src/lib/request-log.ts.
const REQUEST_ID_HEADER = "x-request-id";

// /api/health is for uptime checks (step 3.8), so it needs no session.
const PUBLIC_PATHS = ["/login", "/auth/", "/api/health"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p,
  );
}

/**
 * Refreshes the Supabase session cookie and sends signed-out visitors on
 * protected paths to /login?next=… . This is a convenience, not the
 * authorization boundary: pages and Server Actions still call getUser().
 */
export async function updateSession(request: NextRequest) {
  // Every request gets an id (step 3.8): reuse one from upstream (e.g. Vercel)
  // if it looks sane, else make one. Forwarded to the app, where requestLog()
  // puts it on every log line, and returned to the client for support.
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId =
    incoming && /^[\w-]{8,128}$/.test(incoming)
      ? incoming
      : crypto.randomUUID();
  const forwarded = new Headers(request.headers);
  forwarded.set(REQUEST_ID_HEADER, requestId);
  const next = () => {
    const r = NextResponse.next({ request: { headers: forwarded } });
    r.headers.set(REQUEST_ID_HEADER, requestId);
    return r;
  };

  let response = next();

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = next();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Don't run code between createServerClient and getUser(): it triggers the
  // token refresh that the cookies above persist.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    const redirect = NextResponse.redirect(url);
    // Keep any cookie changes (e.g. a cleared expired session).
    for (const cookie of response.cookies.getAll())
      redirect.cookies.set(cookie);
    return redirect;
  }

  return response;
}
