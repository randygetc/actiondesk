"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import type { ProjectAction } from "./types";

export function ProjectDangerZone({
  archiveAction,
  deleteAction,
  id,
  archived,
  taskCount,
}: {
  archiveAction: ProjectAction;
  deleteAction: ProjectAction;
  id: string;
  archived: boolean;
  taskCount: number;
}) {
  const [archiveState, archiveFormAction, archiving] = useActionState(
    archiveAction,
    null,
  );
  const [deleteState, deleteFormAction, deleting] = useActionState(
    deleteAction,
    null,
  );
  const error =
    (archiveState && !archiveState.ok && archiveState.error) ||
    (deleteState && !deleteState.ok && deleteState.error);

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4">
      <form action={archiveFormAction} className="flex items-center gap-3">
        <input type="hidden" name="id" value={id} />
        <input
          type="hidden"
          name="archived"
          value={archived ? "false" : "true"}
        />
        <Button type="submit" variant="outline" disabled={archiving}>
          {archived ? "Restore project" : "Archive project"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {archived
            ? "Restoring puts it back in your project list."
            : "Archiving hides it from your project list. You can restore it later."}
        </span>
      </form>

      {/* <details> works before hydration, so the confirm step never dead-clicks. */}
      <details className="text-sm">
        <summary className="cursor-pointer select-none">
          Delete project…
        </summary>
        <form
          action={deleteFormAction}
          className="mt-3 flex items-center gap-3"
        >
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="destructive" disabled={deleting}>
            {deleting ? "Deleting…" : "Yes, delete permanently"}
          </Button>
          <span className="text-muted-foreground">
            This can&apos;t be undone.{" "}
            {taskCount === 0
              ? "The project has no tasks."
              : `Its ${taskCount} ${taskCount === 1 ? "task stays" : "tasks stay"}, without a project.`}
          </span>
        </form>
      </details>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
