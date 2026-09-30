import Link from "next/link";

import {
  EditTaskDialog,
  type EditableTask,
} from "@/components/tasks/edit-task-dialog";
import { QuickAddForm } from "@/components/tasks/quick-add-form";
import { TaskRow } from "@/components/tasks/task-row";
import type { TaskRowData } from "@/components/tasks/types";
import { requireUser } from "@/lib/auth/user";
import { GROUP_LABELS, groupTasks } from "@/lib/time/grouping";
import { END_OF_DAY, toLocalParts } from "@/lib/time/zones";
import { taskIdSchema } from "@/lib/validation/task";

import {
  completeTask,
  createTask,
  deleteTask,
  reopenTask,
  updateTask,
} from "./actions";

const TASK_COLUMNS =
  "id, title, notes, status, priority, due_at, recurrence, project_id, project:projects(id, name)";

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const params = await searchParams;
  const showDone = params.show === "done";
  const { supabase, user } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();
  const tz = profile?.timezone ?? "America/Los_Angeles";
  // The only clock read on this page; grouping itself is pure (plan §1).
  const now = new Date();

  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .order("due_at", { nullsFirst: false });
  if (!showDone) query = query.neq("status", "done");
  const { data: tasks, error } = await query.limit(500);
  if (error) throw new Error("Couldn't load tasks.");

  const { groups, done } = groupTasks(tasks, now, tz);
  const withParams = (extra: Record<string, string>) => {
    const q = new URLSearchParams({
      ...(showDone ? { show: "done" } : {}),
      ...extra,
    });
    const s = q.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };

  const editId = taskIdSchema.safeParse(params.edit);
  const editing = editId.success
    ? tasks.find((t) => t.id === editId.data)
    : undefined;
  const { data: projects } = editing
    ? await supabase
        .from("projects")
        .select("id, name")
        .or(
          `archived_at.is.null,id.eq.${editing.project_id ?? "00000000-0000-0000-0000-000000000000"}`,
        )
        .order("name")
    : { data: [] };

  const row = (task: TaskRowData) => (
    <TaskRow
      key={task.id}
      task={task}
      tz={tz}
      now={now}
      editHref={withParams({ edit: task.id })}
      completeAction={completeTask}
      reopenAction={reopenTask}
    />
  );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <Link
          href={showDone ? "/tasks" : "/tasks?show=done"}
          className="text-sm underline"
        >
          {showDone ? "Hide done" : "Show done"}
        </Link>
      </div>

      <QuickAddForm action={createTask} />

      {groups.length === 0 && !showDone ? (
        <p className="text-sm text-muted-foreground">
          Nothing to do. Add a task above.
        </p>
      ) : null}

      {groups.map(({ group, tasks }) => (
        <section
          key={group}
          aria-labelledby={`group-${group}`}
          className="flex flex-col gap-2"
        >
          <h2
            id={`group-${group}`}
            className="text-sm font-medium text-muted-foreground"
          >
            {GROUP_LABELS[group]}
          </h2>
          <ul className="divide-y rounded-md border">{tasks.map(row)}</ul>
        </section>
      ))}

      {showDone ? (
        <section aria-labelledby="group-done" className="flex flex-col gap-2">
          <h2
            id="group-done"
            className="text-sm font-medium text-muted-foreground"
          >
            Done
          </h2>
          {done.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed tasks.</p>
          ) : (
            <ul className="divide-y rounded-md border">{done.map(row)}</ul>
          )}
        </section>
      ) : null}

      {editing ? (
        <EditTaskDialog
          key={editing.id}
          task={toEditable(editing, tz)}
          projects={projects ?? []}
          tz={tz}
          closeHref={withParams({})}
          updateAction={updateTask}
          deleteAction={deleteTask}
        />
      ) : null}
    </div>
  );
}

function toEditable(
  t: TaskRowData & { notes: string | null; project_id: string | null },
  tz: string,
): EditableTask {
  const local = t.due_at ? toLocalParts(new Date(t.due_at), tz) : null;
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
    projectId: t.project_id,
    dueDate: local?.date ?? "",
    dueTime: local && local.time !== END_OF_DAY ? local.time : "",
    recurrence: t.recurrence,
  };
}
