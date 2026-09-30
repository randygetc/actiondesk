import { toUtc } from "@/lib/time/zones";

import type { CaseContext, ScoredTask } from "./schema";

/**
 * Titles pair up when this share of the shorter title's words appear in the
 * other (overlap coefficient). Changed from Jaccard ≥ 0.5 at step 2.3: correct
 * but longer titles ("Sign the vendor contract and send it back to Ana" for
 * "Sign and return the vendor contract") failed to pair.
 */
export const TITLE_MATCH_THRESHOLD = 0.6;

const STOPWORDS = new Set(
  "a an and the to for of on in at with by from my our is be it this that".split(
    " ",
  ),
);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w && !STOPWORDS.has(w)),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 && y.size === 0) return 1;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  if (x.size === 0 || y.size === 0) return 0;
  return shared / Math.min(x.size, y.size);
}

export type Pair = { expected: ScoredTask; actual: ScoredTask; sim: number };

/** Greedy one-to-one pairing, most similar titles first. */
export function matchTasks(
  expected: ScoredTask[],
  actual: ScoredTask[],
): Pair[] {
  const candidates = expected
    .flatMap((e, i) =>
      actual.map((a, j) => ({ i, j, sim: titleSimilarity(e.title, a.title) })),
    )
    .filter((c) => c.sim >= TITLE_MATCH_THRESHOLD)
    .sort((p, q) => q.sim - p.sim || p.i - q.i || p.j - q.j);

  const usedE = new Set<number>();
  const usedA = new Set<number>();
  const pairs: Pair[] = [];
  for (const c of candidates) {
    if (usedE.has(c.i) || usedA.has(c.j)) continue;
    usedE.add(c.i);
    usedA.add(c.j);
    pairs.push({ expected: expected[c.i], actual: actual[c.j], sim: c.sim });
  }
  return pairs;
}

/** "me" and the user's own name are the same assignee. */
function sameAssignee(e: string, a: string, userName: string): boolean {
  const norm = (s: string) => {
    const t = s.trim().toLowerCase();
    return t === userName.trim().toLowerCase() ? "me" : t;
  };
  return norm(e) === norm(a);
}

/** Due dates compare as UTC instants, after the same conversion the app uses. */
function sameDue(e: ScoredTask, a: ScoredTask, tz: string): boolean {
  if (e.due_date === null || a.due_date === null)
    return e.due_date === a.due_date;
  return (
    toUtc(e.due_date, e.due_time, tz).getTime() ===
    toUtc(a.due_date, a.due_time, tz).getTime()
  );
}

export const FIELDS = ["title", "assignee", "due", "project"] as const;
export type Field = (typeof FIELDS)[number];

export type CaseScore = {
  expected: number;
  actual: number;
  /** F1 per field: a field counts as correct only on a matched pair. */
  f1: Record<Field, number>;
  /** Mean of the field F1s, 0–1. */
  score: number;
  pairs: Pair[];
};

function f1(correct: number, expected: number, actual: number): number {
  if (expected === 0 && actual === 0) return 1;
  if (correct === 0) return 0;
  const precision = correct / actual;
  const recall = correct / expected;
  return (2 * precision * recall) / (precision + recall);
}

export function scoreCase(
  context: CaseContext,
  expected: ScoredTask[],
  actual: ScoredTask[],
): CaseScore {
  const pairs = matchTasks(expected, actual);
  const correct: Record<Field, number> = {
    title: pairs.length,
    assignee: pairs.filter((p) =>
      sameAssignee(p.expected.assignee, p.actual.assignee, context.userName),
    ).length,
    due: pairs.filter((p) => sameDue(p.expected, p.actual, context.timezone))
      .length,
    project: pairs.filter((p) => p.expected.project_id === p.actual.project_id)
      .length,
  };
  const scores = Object.fromEntries(
    FIELDS.map((f) => [f, f1(correct[f], expected.length, actual.length)]),
  ) as Record<Field, number>;
  const score = FIELDS.reduce((s, f) => s + scores[f], 0) / FIELDS.length;
  return {
    expected: expected.length,
    actual: actual.length,
    f1: scores,
    score,
    pairs,
  };
}
