"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspace, VIEW_ONLY_MESSAGE } from "@/lib/workspace/current";
import {
  archiveProjectSchema,
  createProjectSchema,
  deleteProjectSchema,
  renameProjectSchema,
} from "@/lib/validation/project";

export type ProjectResult = ActionResult<{ id: string }>;

function invalid(error: z.ZodError): ProjectResult {
  return {
    ok: false,
    error: "Please fix the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<
      string,
      string[] | undefined
    >,
  };
}

const signedOut: ProjectResult = { ok: false, error: "You are signed out." };
const notFound: ProjectResult = { ok: false, error: "Project not found." };
const viewOnly: ProjectResult = { ok: false, error: VIEW_ONLY_MESSAGE };

/**
 * After an update or delete matched 0 rows: a project the user can still see
 * means RLS refused the write (a viewer); otherwise it's missing or in another
 * workspace, which looks the same as missing.
 */
async function missingOrViewOnly(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<ProjectResult> {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return data ? viewOnly : notFound;
}

/** Maps Postgres errors to messages; never returns raw DB errors to the client. */
function dbError(
  code: string | undefined,
  userId: string,
  event: string,
): ProjectResult {
  if (code === "42501") return viewOnly;
  if (code === "23505") {
    return {
      ok: false,
      error:
        "This workspace already has a project with that name (it may be archived).",
      fieldErrors: { name: ["Name already used"] },
    };
  }
  log.warn(event, { userId, code });
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function getUserClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function revalidate(id?: string) {
  revalidatePath("/projects");
  if (id) revalidatePath(`/projects/${id}`);
}

export async function createProject(
  _prev: ProjectResult | null,
  formData: FormData,
): Promise<ProjectResult> {
  const parsed = createProjectSchema.safeParse({
    name: formData.get("name") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;

  // New projects go into the current workspace (D-23); RLS checks the role.
  const { current } = await currentWorkspace(supabase, user.id);
  const { data, error } = await supabase
    .from("projects")
    .insert({ name: parsed.data.name, workspace_id: current.id })
    .select("id")
    .single();
  if (error) return dbError(error.code, user.id, "project.create_failed");

  log.info("project.created", { userId: user.id, projectId: data.id });
  revalidate();
  return { ok: true, data: { id: data.id } };
}

export async function renameProject(
  _prev: ProjectResult | null,
  formData: FormData,
): Promise<ProjectResult> {
  const parsed = renameProjectSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;

  // RLS limits writes to members of the project's workspace.
  const { data, error } = await supabase
    .from("projects")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return dbError(error.code, user.id, "project.rename_failed");
  if (data.length === 0) return missingOrViewOnly(supabase, parsed.data.id);

  log.info("project.renamed", { userId: user.id, projectId: parsed.data.id });
  revalidate(parsed.data.id);
  return { ok: true, data: { id: parsed.data.id } };
}

/** Archive (archived=true) or restore (archived=false). Archiving is the normal way to retire a project (D-3). */
export async function archiveProject(
  _prev: ProjectResult | null,
  formData: FormData,
): Promise<ProjectResult> {
  const parsed = archiveProjectSchema.safeParse({
    id: formData.get("id"),
    archived: formData.get("archived"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;

  const { data, error } = await supabase
    .from("projects")
    .update({
      archived_at: parsed.data.archived ? new Date().toISOString() : null,
    })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return dbError(error.code, user.id, "project.archive_failed");
  if (data.length === 0) return missingOrViewOnly(supabase, parsed.data.id);

  log.info(parsed.data.archived ? "project.archived" : "project.restored", {
    userId: user.id,
    projectId: parsed.data.id,
  });
  revalidate(parsed.data.id);
  return { ok: true, data: { id: parsed.data.id } };
}

/** Hard delete, then back to the list. From 1.7, the project's tasks stay, with no project (D-3). */
export async function deleteProject(
  _prev: ProjectResult | null,
  formData: FormData,
): Promise<ProjectResult> {
  const parsed = deleteProjectSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return invalid(parsed.error);

  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;

  const { data, error } = await supabase
    .from("projects")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return dbError(error.code, user.id, "project.delete_failed");
  if (data.length === 0) return missingOrViewOnly(supabase, parsed.data.id);

  log.info("project.deleted", { userId: user.id, projectId: parsed.data.id });
  revalidate();
  redirect("/projects");
}
