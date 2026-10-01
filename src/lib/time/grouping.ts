/** Task list grouping in the profile's zone, with an injected `now` (plan §2.4, D-6). */
import { toLocalParts, toUtc, toZoned } from "./zones";

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
  return groupIn(weekOf(now, tz), dueAt, now, tz);
}

/** Today and this week's Sunday as local dates; computed once per list. */
function weekOf(now: Date, tz: string) {
  const today = toZoned(now, tz).toPlainDate();
  return {
    today: today.toString(),
    sunday: today.add({ days: 7 - today.dayOfWeek }).toString(),
  };
}

function groupIn(
  week: { today: string; sunday: string },
  dueAt: Date | null,
  now: Date,
  tz: string,
): Group {
  if (!dueAt) return "noDate";
  if (dueAt < now) return "overdue";
  // ISO dates compare correctly as strings.
  const due = toLocalParts(dueAt, tz).date;
  if (due === week.today) return "today";
  return due <= week.sunday ? "thisWeek" : "later";
}

/**
 * Where Today and This week end, as UTC instants (exclusive), so a list can
 * query each group by a due_at range instead of loading every task (step 3.7).
 * A task is overdue before `now`, today before `todayEnd`, this week before
 * `weekEnd`, later after. Equivalent to groupFor (tested across DST changes).
 */
export function groupBounds(
  now: Date,
  tz: string,
): { todayEnd: Date; weekEnd: Date } {
  const today = toZoned(now, tz).toPlainDate();
  return {
    todayEnd: toUtc(today.add({ days: 1 }).toString(), "00:00", tz),
    weekEnd: toUtc(
      today.add({ days: 8 - today.dayOfWeek }).toString(),
      "00:00",
      tz,
    ),
  };
}

type Groupable = { due_at: string | null; status: string };

/** Open tasks in GROUP_ORDER (non-empty groups only, sorted by due date); done tasks apart. */
export function groupTasks<T extends Groupable>(
  tasks: readonly T[],
  now: Date,
  tz: string,
) {
  const week = weekOf(now, tz);
  const buckets = new Map<Group, T[]>(GROUP_ORDER.map((g) => [g, []]));
  const done: T[] = [];
  for (const task of tasks) {
    if (task.status === "done") done.push(task);
    else
      buckets
        .get(
          groupIn(week, task.due_at ? new Date(task.due_at) : null, now, tz),
        )!
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
