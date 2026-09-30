import Link from "next/link";

import { describeRecurrence } from "@/lib/time/recurrence";
import { formatDue } from "@/lib/time/zones";

import { PRIORITY_LABELS, type RowAction, type TaskRowData } from "./types";

/**
 * One task. The complete/reopen control is a submit button with role
 * "checkbox", so it works before hydration (no onChange handler needed).
 */
export function TaskRow({
  task,
  tz,
  now,
  editHref,
  completeAction,
  reopenAction,
  readOnly = false,
}: {
  task: TaskRowData;
  tz: string;
  now: Date;
  editHref: string;
  completeAction: RowAction;
  reopenAction: RowAction;
  /** Viewers (step 3.2): status shown, no complete/edit controls. */
  readOnly?: boolean;
}) {
  const done = task.status === "done";
  const due = task.due_at ? new Date(task.due_at) : null;
  const overdue = !done && due !== null && due < now;
  const repeat = task.recurrence ? describeRecurrence(task.recurrence) : null;

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      {readOnly ? (
        <span
          role="img"
          aria-label={done ? "Done" : "Not done"}
          className="flex size-4 items-center justify-center rounded border text-xs text-muted-foreground"
        >
          {done ? "✓" : null}
        </span>
      ) : (
        <form action={done ? reopenAction : completeAction}>
          <input type="hidden" name="id" value={task.id} />
          <button
            type="submit"
            role="checkbox"
            aria-checked={done}
            aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
            className="flex size-4 items-center justify-center rounded border text-xs"
          >
            {done ? "✓" : null}
          </button>
        </form>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {readOnly ? (
          <span
            className={`truncate ${done ? "text-muted-foreground line-through" : ""}`}
          >
            {task.title}
          </span>
        ) : (
          <Link
            href={editHref}
            className={`truncate ${done ? "text-muted-foreground line-through" : ""}`}
          >
            {task.title}
          </Link>
        )}
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {due ? (
            <span className={overdue ? "text-destructive" : ""}>
              {formatDue(due, tz)}
            </span>
          ) : null}
          {repeat ? <span>{repeat}</span> : null}
          {task.status === "doing" ? <span>Doing</span> : null}
          {task.project ? (
            <Link href={`/projects/${task.project.id}`} className="underline">
              {task.project.name}
            </Link>
          ) : null}
        </div>
      </div>
      {task.priority !== "normal" ? (
        <span className="rounded bg-muted px-2 py-0.5 text-xs">
          {PRIORITY_LABELS[task.priority]}
        </span>
      ) : null}
    </li>
  );
}
