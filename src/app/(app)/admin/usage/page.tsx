import { requireUser } from "@/lib/auth/user";

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
  // Aggregated in SQL (review #6), so the report can't be truncated by volume.
  const { data, error } = await supabase.rpc("llm_usage_report", {
    p_tz: tz,
    p_days: DAYS,
  });
  const lines = data ?? [];
  const total = lines.reduce((s, l) => s + Number(l.cost_usd), 0);
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
                  {l.input_tokens.toLocaleString("en-US")}
                </td>
                <td className="text-right">
                  {l.cached_tokens.toLocaleString("en-US")}
                </td>
                <td className="text-right">
                  {l.output_tokens.toLocaleString("en-US")}
                </td>
                <td className="text-right">{l.capped}</td>
                <td className="text-right">{l.failed}</td>
                <td className="text-right">{usd(Number(l.cost_usd))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
