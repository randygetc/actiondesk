import { toLocalParts } from "@/lib/time/zones";

export type UsageRow = {
  created_at: string;
  feature: "extract" | "ask";
  outcome: "ok" | "invalid_output" | "error" | "capped" | "aborted";
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  user_id: string;
};

export type UsageLine = {
  day: string;
  feature: UsageRow["feature"];
  calls: number;
  users: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  capped: number;
  failed: number;
};

/** Usage per local day and feature, newest day first (the admin usage page). */
export function usageByDay(rows: UsageRow[], tz: string): UsageLine[] {
  const lines = new Map<string, UsageLine & { userIds: Set<string> }>();
  for (const r of rows) {
    const day = toLocalParts(new Date(r.created_at), tz).date;
    const key = `${day}|${r.feature}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        day,
        feature: r.feature,
        calls: 0,
        users: 0,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        capped: 0,
        failed: 0,
        userIds: new Set(),
      };
      lines.set(key, line);
    }
    line.calls++;
    line.userIds.add(r.user_id);
    line.costUsd += Number(r.cost_usd);
    line.inputTokens += r.input_tokens;
    line.outputTokens += r.output_tokens;
    line.cachedTokens += r.cached_tokens;
    if (r.outcome === "capped") line.capped++;
    if (r.outcome === "error" || r.outcome === "invalid_output") line.failed++;
  }
  return [...lines.values()]
    .map(({ userIds, ...l }) => ({
      ...l,
      users: userIds.size,
      costUsd: Math.round(l.costUsd * 1e6) / 1e6,
    }))
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) || a.feature.localeCompare(b.feature),
    );
}
