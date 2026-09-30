import { requireUser } from "@/lib/auth/user";
import { usageByDay, type UsageRow } from "@/lib/usage-report";

// Admin-only usage report (D-11). RLS decides what rows come back: admins see
// everyone's usage, anyone else only their own. The is_app_admin() check here
// only picks the clearer page.

const DAYS = 30;

export default async function UsagePage() {
  const { supabase, user } = await requireUser();
  const [{ data: isAdmin }, { data: profile }] = await Promise.all([
    supabase.rpc("is_app_admin"),
    supabase.from("profiles").select("timezone").eq("id", user.id).single(),
  ]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is for admins only.
        </p>
      </div>
    );
  }

  const tz = profile?.timezone ?? "America/Los_Angeles";
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("llm_usage")
    .select(
      "created_at, feature, outcome, cost_usd, input_tokens, output_tokens, cached_tokens, user_id",
    )
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(10_000);

  const lines = usageByDay((data ?? []) as UsageRow[], tz);
  const total = lines.reduce((s, l) => s + l.costUsd, 0);
  const usd = (n: number) => `$${n.toFixed(4)}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Last {DAYS} days, all users, by day in {tz}. Total {usd(total)}.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load usage.
        </p>
      ) : lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No usage yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1">Day</th>
              <th>Feature</th>
              <th className="text-right">Calls</th>
              <th className="text-right">Users</th>
              <th className="text-right">Input</th>
              <th className="text-right">Cached</th>
              <th className="text-right">Output</th>
              <th className="text-right">Capped</th>
              <th className="text-right">Failed</th>
              <th className="text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.day}-${l.feature}`} className="border-t">
                <td className="py-1">{l.day}</td>
                <td>{l.feature}</td>
                <td className="text-right">{l.calls}</td>
                <td className="text-right">{l.users}</td>
                <td className="text-right">
                  {l.inputTokens.toLocaleString("en-US")}
                </td>
                <td className="text-right">
                  {l.cachedTokens.toLocaleString("en-US")}
                </td>
                <td className="text-right">
                  {l.outputTokens.toLocaleString("en-US")}
                </td>
                <td className="text-right">{l.capped}</td>
                <td className="text-right">{l.failed}</td>
                <td className="text-right">{usd(l.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
