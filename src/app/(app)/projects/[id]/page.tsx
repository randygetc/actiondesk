import Link from "next/link";
import { notFound } from "next/navigation";

import { ProjectDangerZone } from "@/components/projects/project-danger-zone";
import { RenameProjectForm } from "@/components/projects/rename-project-form";
import { QuickAddForm } from "@/components/tasks/quick-add-form";
import { TaskRow } from "@/components/tasks/task-row";
import { requireUser } from "@/lib/auth/user";
import { projectIdSchema } from "@/lib/validation/project";
import { canEdit, myWorkspaces } from "@/lib/workspace/current";

import { completeTask, createTask, reopenTask } from "../../tasks/actions";
import { archiveProject, deleteProject, renameProject } from "../actions";

export default async function ProjectPage({
  params,
}: PageProps<"/projects/[id]">) {
  const parsed = projectIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  const { supabase, user } = await requireUser();
  // RLS returns nothing for a project outside the user's workspaces, so it
  // 404s like a missing one. The page follows the project's own workspace,
  // which may not be the current one.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, archived_at, workspace_id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!project) notFound();

  const archived = project.archived_at !== null;
  const workspace = (await myWorkspaces(supabase, user.id)).find(
    (w) => w.id === project.workspace_id,
  );
  const editable = !!workspace && canEdit(workspace.role);

  const [{ data: profile }, { data: tasks }, { count: taskCount }] =
    await Promise.all([
      supabase.from("profiles").select("timezone").eq("id", user.id).single(),
      supabase
        .from("tasks")
        .select(
          "id, title, status, priority, due_at, recurrence, project:projects(id, name)",
        )
        .eq("project_id", project.id)
        .neq("status", "done")
        .order("due_at", { nullsFirst: false })
        .limit(200),
      // Every task in the project, done ones included, for the delete warning (D-3).
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project.id),
    ]);
  const tz = profile?.timezone ?? "America/Los_Angeles";
  const now = new Date();

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Link
        href={archived ? "/projects?show=archived" : "/projects"}
        className="text-sm underline"
      >
        ← Projects
      </Link>
      <h1 className="text-xl font-semibold">
        {project.name}
        {archived ? (
          <span className="ml-2 rounded bg-muted px-2 py-0.5 align-middle text-xs font-normal">
            Archived
          </span>
        ) : null}
      </h1>

      {workspace ? (
        <p className="text-sm text-muted-foreground">
          In {workspace.name}
          {editable ? "" : " (view only)"}
        </p>
      ) : null}

      {editable ? (
        <RenameProjectForm
          action={renameProject}
          id={project.id}
          name={project.name}
        />
      ) : null}

      <section aria-labelledby="project-tasks" className="flex flex-col gap-2">
        <h2 id="project-tasks" className="font-medium">
          Open tasks
        </h2>
        {archived || !editable ? null : (
          <QuickAddForm action={createTask} projectId={project.id} />
        )}
        {tasks && tasks.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                tz={tz}
                now={now}
                editHref={`/tasks?edit=${task.id}`}
                completeAction={completeTask}
                reopenAction={reopenTask}
                readOnly={!editable}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No open tasks.</p>
        )}
      </section>

      {editable ? (
        <ProjectDangerZone
          archiveAction={archiveProject}
          deleteAction={deleteProject}
          id={project.id}
          archived={archived}
          taskCount={taskCount ?? 0}
        />
      ) : null}
    </div>
  );
}
