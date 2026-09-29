"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseRRule, WEEKDAYS, type Preset } from "@/lib/time/recurrence";
import {
  REPEAT_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/validation/task";

import {
  fieldClass,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TaskAction,
} from "./types";

export type EditableTask = {
  id: string;
  title: string;
  notes: string | null;
  status: "todo" | "doing" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  projectId: string | null;
  dueDate: string; // local, in the profile zone
  dueTime: string; // "" when end of day
  recurrence: string | null;
};

const REPEAT_LABELS: Record<(typeof REPEAT_KINDS)[number], string> = {
  none: "Does not repeat",
  daily: "Daily",
  weekdays: "Every weekday",
  weekly: "Weekly on…",
  everyNWeeks: "Every N weeks on…",
  monthlyDay: "Monthly on day…",
  monthlyNth: "Monthly on the Nth weekday…",
};

const DAY_LABELS = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

function presetDefaults(p: Preset | null) {
  return {
    repeat: p?.kind ?? "none",
    weekday: p && "day" in p && typeof p.day === "string" ? p.day : "MO",
    interval: p?.kind === "everyNWeeks" ? String(p.n) : "2",
    monthDay: p?.kind === "monthlyDay" ? String(p.day) : "1",
    nth: p?.kind === "monthlyNth" ? String(p.nth) : "1",
  };
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
      {error ? <span className="text-destructive">{error}</span> : null}
    </label>
  );
}

export function EditTaskDialog({
  task,
  projects,
  tz,
  closeHref,
  updateAction,
  deleteAction,
}: {
  task: EditableTask;
  projects: { id: string; name: string }[];
  tz: string;
  closeHref: string;
  updateAction: TaskAction;
  deleteAction: TaskAction;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateAction, null);
  const [deleteState, deleteFormAction, deleting] = useActionState(
    deleteAction,
    null,
  );
  const defaults = presetDefaults(
    task.recurrence ? parseRRule(task.recurrence) : null,
  );
  const [repeat, setRepeat] = useState(defaults.repeat);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (k: string) => errors?.[k]?.[0];

  const dayPicker = (
    <select
      name="weekday"
      aria-label="Day"
      defaultValue={defaults.weekday}
      className={fieldClass}
    >
      {WEEKDAYS.map((d) => (
        <option key={d} value={d}>
          {DAY_LABELS[d]}
        </option>
      ))}
    </select>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && router.push(closeHref)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={task.id} />
          <Field label="Title" error={err("title")}>
            <input
              name="title"
              defaultValue={task.title}
              required
              maxLength={200}
              className={fieldClass}
            />
          </Field>
          <Field label="Notes" error={err("notes")}>
            <textarea
              name="notes"
              defaultValue={task.notes ?? ""}
              maxLength={10_000}
              rows={4}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                name="status"
                defaultValue={task.status}
                className={fieldClass}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                name="priority"
                defaultValue={task.priority}
                className={fieldClass}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Project" error={err("projectId")}>
            <select
              name="projectId"
              defaultValue={task.projectId ?? ""}
              className={fieldClass}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date" error={err("dueDate")}>
              <input
                type="date"
                name="dueDate"
                defaultValue={task.dueDate}
                className={fieldClass}
              />
            </Field>
            <Field label="Time (optional)" error={err("dueTime")}>
              <input
                type="time"
                name="dueTime"
                defaultValue={task.dueTime}
                className={fieldClass}
              />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Times are in {tz}. Without a time, the task is due by the end of the
            day.
          </p>

          <Field
            label="Repeat"
            error={
              err("weekday") ?? err("interval") ?? err("monthDay") ?? err("nth")
            }
          >
            <select
              name="repeat"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as typeof repeat)}
              className={fieldClass}
            >
              {REPEAT_KINDS.map((r) => (
                <option key={r} value={r}>
                  {REPEAT_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          {repeat === "weekly" ? dayPicker : null}
          {repeat === "everyNWeeks" ? (
            <div className="flex items-center gap-2 text-sm">
              Every
              <input
                type="number"
                name="interval"
                aria-label="Weeks"
                min={2}
                max={52}
                defaultValue={defaults.interval}
                className={`${fieldClass} w-20`}
              />
              weeks on {dayPicker}
            </div>
          ) : null}
          {repeat === "monthlyDay" ? (
            <select
              name="monthDay"
              aria-label="Day of month"
              defaultValue={defaults.monthDay}
              className={fieldClass}
            >
              {Array.from({ length: 28 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Day {i + 1}
                </option>
              ))}
              <option value="-1">Last day</option>
            </select>
          ) : null}
          {repeat === "monthlyNth" ? (
            <div className="flex items-center gap-2 text-sm">
              The
              <select
                name="nth"
                aria-label="Week of month"
                defaultValue={defaults.nth}
                className={fieldClass}
              >
                <option value="1">1st</option>
                <option value="2">2nd</option>
                <option value="3">3rd</option>
                <option value="4">4th</option>
                <option value="-1">Last</option>
              </select>
              {dayPicker}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {state && !state.ok ? (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            ) : null}
          </div>
        </form>

        <details className="border-t pt-3 text-sm">
          <summary className="cursor-pointer select-none">Delete task…</summary>
          <form
            action={deleteFormAction}
            className="mt-3 flex items-center gap-3"
          >
            <input type="hidden" name="id" value={task.id} />
            <Button type="submit" variant="destructive" disabled={deleting}>
              {deleting ? "Deleting…" : "Yes, delete permanently"}
            </Button>
            {deleteState && !deleteState.ok ? (
              <span className="text-destructive">{deleteState.error}</span>
            ) : (
              <span className="text-muted-foreground">
                {task.recurrence
                  ? "Deletes only this occurrence."
                  : "This can't be undone."}
              </span>
            )}
          </form>
        </details>
      </DialogContent>
    </Dialog>
  );
}
