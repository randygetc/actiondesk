import Link from "next/link";
import { notFound } from "next/navigation";

import { ProjectDangerZone } from "@/components/projects/project-danger-zone";
import { RenameProjectForm } from "@/components/projects/rename-project-form";
import { requireUser } from "@/lib/auth/user";
import { projectIdSchema } from "@/lib/validation/project";

import { archiveProject, deleteProject, renameProject } from "../actions";

export default async function ProjectPage({
  params,
}: PageProps<"/projects/[id]">) {
  const parsed = projectIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  const { supabase } = await requireUser();
  // RLS returns nothing for another user's project, so it 404s like a missing one.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, archived_at")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!project) notFound();

  const archived = project.archived_at !== null;

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

      <RenameProjectForm
        action={renameProject}
        id={project.id}
        name={project.name}
      />

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Tasks</h2>
        <p className="text-sm text-muted-foreground">
          Tasks arrive in step 1.7.
        </p>
      </section>

      <ProjectDangerZone
        archiveAction={archiveProject}
        deleteAction={deleteProject}
        id={project.id}
        archived={archived}
      />
    </div>
  );
}
