import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";

// The current workspace (D-23): a preference in the `ws` cookie. It is only a
// filter for lists and a default for creates; RLS decides what the user may
// read or change (R-28). A cookie naming a workspace the user isn't a member
// of is ignored.

export const WORKSPACE_COOKIE = "ws";

export type Role = Database["public"]["Enums"]["workspace_role"];
export type Workspace = { id: string; name: string; role: Role };

/** Every workspace the signed-in user belongs to, Personal first. */
export async function myWorkspaces(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspace:workspaces(id, name, created_at)")
    .eq("user_id", userId);
  if (error) throw new Error("Couldn't load workspaces.");
  return (data ?? [])
    .flatMap((m) => (m.workspace ? [{ ...m.workspace, role: m.role }] : []))
    .sort(
      (a, b) =>
        Number(b.name === "Personal") - Number(a.name === "Personal") ||
        a.created_at.localeCompare(b.created_at),
    )
    .map(({ id, name, role }) => ({ id, name, role }));
}

/** The workspace named by the cookie if the user is a member, else the first (Personal). */
export async function currentWorkspace(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ current: Workspace; all: Workspace[] }> {
  const all = await myWorkspaces(supabase, userId);
  if (all.length === 0) throw new Error("No workspace.");
  const wanted = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return { current: all.find((w) => w.id === wanted) ?? all[0], all };
}

export const canEdit = (role: Role) => role !== "viewer";

/** Shown when RLS refuses a write because the user is a viewer. */
export const VIEW_ONLY_MESSAGE = "You can view this workspace but not edit it.";
