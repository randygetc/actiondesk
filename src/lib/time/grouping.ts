/** Task list grouping in the profile's zone, with an injected `now` (plan §2.4, D-6). */
import { Temporal } from "temporal-polyfill";

import { toZoned } from "./zones";

export type Group = "overdue" | "today" | "thisWeek" | "later" | "noDate";

export const GROUP_ORDER: readonly Group[] = [
  "overdue",
  "today",
  "thisWeek",
  "later",
  "noDate",
];

export const GROUP_LABELS: Record<Group, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  later: "Later",
  noDate: "No date",
};

/**
 * - overdue: due before now
 * - today: due later today (local date)
 * - thisWeek: after today, up to and including Sunday of the current ISO week
 * - later: after this week
 */
export function groupFor(dueAt: Date | null, now: Date, tz: string): Group {
  if (!dueAt) return "noDate";
  if (dueAt < now) return "overdue";
  const today = toZoned(now, tz).toPlainDate();
  const due = toZoned(dueAt, tz).toPlainDate();
  if (due.equals(today)) return "today";
  const sunday = today.add({ days: 7 - today.dayOfWeek });
  return Temporal.PlainDate.compare(due, sunday) <= 0 ? "thisWeek" : "later";
}

type Groupable = { due_at: string | null; status: string };

/** Open tasks in GROUP_ORDER (non-empty groups only, sorted by due date); done tasks apart. */
export function groupTasks<T extends Groupable>(
  tasks: readonly T[],
  now: Date,
  tz: string,
) {
  const buckets = new Map<Group, T[]>(GROUP_ORDER.map((g) => [g, []]));
  const done: T[] = [];
  for (const task of tasks) {
    if (task.status === "done") done.push(task);
    else
      buckets
        .get(groupFor(task.due_at ? new Date(task.due_at) : null, now, tz))!
        .push(task);
  }
  const byDue = (a: T, b: T) =>
    (a.due_at ? Date.parse(a.due_at) : Infinity) -
    (b.due_at ? Date.parse(b.due_at) : Infinity);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    tasks: buckets.get(group)!.sort(byDue),
  })).filter((g) => g.tasks.length > 0);
  return { groups, done };
}
