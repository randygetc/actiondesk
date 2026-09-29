import Link from "next/link";

import { CreateProjectForm } from "@/components/projects/create-project-form";
import { requireUser } from "@/lib/auth/user";

import { createProject } from "./actions";

export default async function ProjectsPage({
  searchParams,
}: PageProps<"/projects">) {
  const { show } = await searchParams;
  const showArchived = show === "archived";
  const { supabase } = await requireUser();

  let query = supabase
    .from("projects")
    .select("id, name, archived_at")
    .order("name");
  query = showArchived
    ? query.not("archived_at", "is", null)
    : query.is("archived_at", null);
  const { data: projects, error } = await query;
  if (error) throw new Error("Couldn't load projects.");

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">
          {showArchived ? "Archived projects" : "Projects"}
        </h1>
        <Link
          href={showArchived ? "/projects" : "/projects?show=archived"}
          className="text-sm underline"
        >
          {showArchived ? "Show active" : "Show archived"}
        </Link>
      </div>

      {showArchived ? null : <CreateProjectForm action={createProject} />}

      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {showArchived ? "No archived projects." : "No projects yet."}
        </p>
      ) : (
        <ul className="divide-y rounded-md border" aria-label="Projects">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="block px-4 py-2 hover:bg-muted"
              >
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
