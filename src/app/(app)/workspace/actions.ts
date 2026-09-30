"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { myWorkspaces, WORKSPACE_COOKIE } from "@/lib/workspace/current";

/**
 * Switches the current workspace (D-23). Only a workspace the user belongs to
 * is stored; anything else is ignored. Works as a plain form post.
 */
export async function setWorkspace(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("workspaceId"));
  if (!id.success) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const mine = await myWorkspaces(supabase, user.id);
  if (!mine.some((w) => w.id === id.data)) return;
  (await cookies()).set(WORKSPACE_COOKIE, id.data, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
