// Step 3.8: uptime check. Public, cheap, no user data: is the app up, and can
// it reach Supabase Auth and the REST API?
export const dynamic = "force-dynamic";

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const [auth, db] = await Promise.all([
    reachable(`${base}/auth/v1/health`),
    reachable(`${base}/rest/v1/`),
  ]);
  const ok = auth && db;
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      checks: { auth, db },
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
