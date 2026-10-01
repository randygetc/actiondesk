import Link from "next/link";

import {
  EditTaskDialog,
  type EditableTask,
} from "@/components/tasks/edit-task-dialog";
import { QuickAddForm } from "@/components/tasks/quick-add-form";
import { TaskRow } from "@/components/tasks/task-row";
import type { TaskRowData } from "@/components/tasks/types";
import { requireUser } from "@/lib/auth/user";
import {
  GROUP_LABELS,
  GROUP_ORDER,
  groupBounds,
  type Group,
} from "@/lib/time/grouping";
import { END_OF_DAY, toLocalParts } from "@/lib/time/zones";
import { taskIdSchema } from "@/lib/validation/task";
import { canEdit, currentWorkspace } from "@/lib/workspace/current";

import {
  completeTask,
  createTask,
  deleteTask,
  reopenTask,
  updateTask,
} from "./actions";

const TASK_COLUMNS =
  "id, title, notes, status, priority, due_at, recurrence, project_id, project:projects(id, name)";

/** Rows per group unless the user asks for all (step 3.7: rendering is the cost). */
const GROUP_LIMIT = 50;
const ALL_LIMIT = 500;

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const params = await searchParams;
  const showDone = params.show === "done";
  const showAll = params.all === "1";
  const limit = showAll ? ALL_LIMIT : GROUP_LIMIT;
  const { supabase, user } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();
  const tz = profile?.timezone ?? "America/Los_Angeles";
  const { current } = await currentWorkspace(supabase, user.id);
  const editable = canEdit(current.role);
  // The only clock read on this page; grouping itself is pure (plan §1).
  const now = new Date();

  // One small query per group (step 3.7): each reads only its own due_at range
  // through the open-tasks index, with an exact count for "Show all". Filtering
  // by the current workspace narrows what RLS allows (all the user's workspaces).
  const { todayEnd, weekEnd } = groupBounds(now, tz);
  const open = () =>
    supabase
      .from("tasks")
      .select(TASK_COLUMNS, { count: "exact" })
      .eq("workspace_id", current.id)
      .neq("status", "done");
  const ranges: Record<Group, ReturnType<typeof open>> = {
    overdue: open().lt("due_at", now.toISOString()).order("due_at"),
    today: open()
      .gte("due_at", now.toISOString())
      .lt("due_at", todayEnd.toISOString())
      .order("due_at"),
    thisWeek: open()
      .gte("due_at", todayEnd.toISOString())
      .lt("due_at", weekEnd.toISOString())
      .order("due_at"),
    later: open().gte("due_at", weekEnd.toISOString()).order("due_at"),
    noDate: open().is("due_at", null).order("created_at"),
  };
  const [doneResult, ...results] = await Promise.all([
    showDone
      ? supabase
          .from("tasks")
          .select(TASK_COLUMNS, { count: "exact" })
          .eq("workspace_id", current.id)
          .eq("status", "done")
          .order("completed_at", { ascending: false })
          .limit(limit)
      : Promise.resolve(null),
    ...GROUP_ORDER.map((g) => ranges[g].limit(limit)),
  ]);
  if (results.some((r) => r.error) || doneResult?.error)
    throw new Error("Couldn't load tasks.");
  const groups = GROUP_ORDER.map((group, i) => ({
    group,
    tasks: results[i].data ?? [],
    total: results[i].count ?? 0,
  })).filter((g) => g.total > 0);
  const done = doneResult?.data ?? [];
  const doneTotal = doneResult?.count ?? 0;

  const withParams = (extra: Record<string, string>) => {
    const q = new URLSearchParams({
      ...(showDone ? { show: "done" } : {}),
      ...(showAll ? { all: "1" } : {}),
      ...extra,
    });
    const s = q.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };
  const more = (shown: number, total: number) =>
    total > shown ? (
      showAll ? (
        <p className="text-sm text-muted-foreground">
          Showing the first {shown} of {total}.
        </p>
      ) : (
        <Link href={withParams({ all: "1" })} className="text-sm underline">
          Show all ({total})
        </Link>
      )
    ) : null;

  const editId = taskIdSchema.safeParse(params.edit);
  // Loaded by id: the task may be beyond the first rows of its group.
  const editing =
    editId.success && editable
      ? ((
          await supabase
            .from("tasks")
            .select(TASK_COLUMNS)
            .eq("id", editId.data)
            .eq("workspace_id", current.id)
            .maybeSingle()
        ).data ?? undefined)
      : undefined;
  const { data: projects } = editing
    ? await supabase
        .from("projects")
        .select("id, name")
        .eq("workspace_id", current.id)
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
      readOnly={!editable}
    />
  );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Tasks</h1>
          <p
            className="text-sm text-muted-foreground"
            data-testid="workspace-name"
          >
            {current.name}
          </p>
        </div>
        <Link
          href={showDone ? "/tasks" : "/tasks?show=done"}
          className="text-sm underline"
        >
          {showDone ? "Hide done" : "Show done"}
        </Link>
      </div>

      {editable ? (
        <QuickAddForm action={createTask} />
      ) : (
        <p className="text-sm text-muted-foreground">
          You can view {current.name} but not edit it.
        </p>
      )}

      {groups.length === 0 && !showDone ? (
        <p className="text-sm text-muted-foreground">
          {editable ? "Nothing to do. Add a task above." : "Nothing to do."}
        </p>
      ) : null}

      {groups.map(({ group, tasks, total }) => (
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
          {more(tasks.length, total)}
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
            <>
              <ul className="divide-y rounded-md border">{done.map(row)}</ul>
              {more(done.length, doneTotal)}
            </>
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
