import { FIELDS, scoreCase, type CaseScore } from "./score";
import type { EvalCase, ScoredTask } from "./schema";

/**
 * Produces tasks for one case, or null when there is nothing to score (no
 * recording yet). Recorded and live extractors are plugged in at step 2.3.
 */
export type Extractor = (c: EvalCase) => Promise<ScoredTask[] | null>;

export type CaseResult =
  | { name: string; status: "scored"; score: CaseScore }
  | { name: string; status: "pending" }
  | { name: string; status: "error"; error: string };

export type RunResult = {
  cases: CaseResult[];
  /** Mean case score over scored cases, or null if none were scored. */
  overall: number | null;
};

export async function runEval(
  cases: EvalCase[],
  extract: Extractor,
): Promise<RunResult> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    try {
      const actual = await extract(c);
      results.push(
        actual === null
          ? { name: c.name, status: "pending" }
          : {
              name: c.name,
              status: "scored",
              score: scoreCase(c.context, c.expected, actual),
            },
      );
    } catch (e) {
      results.push({
        name: c.name,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  // An error counts as 0: a crash must not raise the average.
  const counted = results.filter((r) => r.status !== "pending");
  const overall =
    counted.length === 0
      ? null
      : counted.reduce(
          (s, r) => s + (r.status === "scored" ? r.score.score : 0),
          0,
        ) / counted.length;
  return { cases: results, overall };
}

const pct = (n: number) => `${Math.round(n * 100)}`.padStart(3) + "%";

export function formatReport({ cases, overall }: RunResult): string {
  const width = Math.max(4, ...cases.map((c) => c.name.length));
  const head = [
    "case".padEnd(width),
    "exp",
    "got",
    ...FIELDS.map((f) => f.padStart(8)),
    " score",
  ].join("  ");
  const rows = cases.map((c) => {
    const name = c.name.padEnd(width);
    if (c.status === "pending") return `${name}  (no recording)`;
    if (c.status === "error") return `${name}  ERROR ${c.error}`;
    const s = c.score;
    return [
      name,
      String(s.expected).padStart(3),
      String(s.actual).padStart(3),
      ...FIELDS.map((f) => pct(s.f1[f]).padStart(8)),
      pct(s.score).padStart(6),
    ].join("  ");
  });
  const counts = (status: CaseResult["status"]) =>
    cases.filter((c) => c.status === status).length;
  const summary =
    overall === null
      ? `overall: n/a (${counts("pending")} of ${cases.length} cases have no recording)`
      : `overall: ${pct(overall).trim()} over ${cases.length - counts("pending")} cases` +
        (counts("pending")
          ? `, ${counts("pending")} without a recording`
          : "") +
        (counts("error") ? `, ${counts("error")} errors` : "");
  return [head, "-".repeat(head.length), ...rows, "", summary].join("\n");
}
