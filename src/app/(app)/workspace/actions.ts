"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import {
  INVITE_ERRORS,
  inviteSchema,
  inviteTokenSchema,
  memberRoleSchema,
  workspaceNameSchema,
} from "@/lib/validation/workspace";
import {
  currentWorkspace,
  myWorkspaces,
  VIEW_ONLY_MESSAGE,
  WORKSPACE_COOKIE,
} from "@/lib/workspace/current";

async function getUserClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function setWorkspaceCookie(id: string) {
  (await cookies()).set(WORKSPACE_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

function refresh() {
  revalidatePath("/", "layout");
}

const signedOut = { ok: false as const, error: "You are signed out." };
const failed = {
  ok: false as const,
  error: "Something went wrong. Please try again.",
};

/**
 * Switches the current workspace (D-23). Only a workspace the user belongs to
 * is stored; anything else is ignored. Works as a plain form post.
 */
export async function setWorkspace(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("workspaceId"));
  if (!id.success) return;
  const { supabase, user } = await getUserClient();
  if (!user) return;
  const mine = await myWorkspaces(supabase, user.id);
  if (!mine.some((w) => w.id === id.data)) return;
  await setWorkspaceCookie(id.data);
  refresh();
}

export async function createWorkspace(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = workspaceNameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success)
    return {
      ok: false,
      error: name.error.issues[0]?.message ?? "Invalid name.",
    };
  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;

  const { data: id, error } = await supabase.rpc("create_workspace", {
    p_name: name.data,
  });
  if (error || !id) {
    log.error("workspace.create_failed", {
      userId: user.id,
      code: error?.code ?? null,
    });
    return failed;
  }
  log.info("workspace.created", { userId: user.id, workspaceId: id });
  await setWorkspaceCookie(id);
  refresh();
  redirect("/workspace");
}

export async function renameWorkspace(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = workspaceNameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success)
    return {
      ok: false,
      error: name.error.issues[0]?.message ?? "Invalid name.",
    };
  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;
  const { current } = await currentWorkspace(supabase, user.id);

  const { data, error } = await supabase
    .from("workspaces")
    .update({ name: name.data })
    .eq("id", current.id)
    .select("id");
  if (error) return failed;
  // RLS: only owners may rename.
  if (data.length === 0)
    return { ok: false, error: "Only an owner can rename the workspace." };
  refresh();
  return { ok: true, data: undefined };
}

export type InviteResult = ActionResult<{ path: string; email: string }>;

/**
 * Creates an invite in the current workspace and returns its link path once.
 * The token isn't stored or logged; only its hash is kept (create_invite).
 */
export async function createInvite(
  _prev: InviteResult | null,
  formData: FormData,
): Promise<InviteResult> {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email") ?? "",
    role: formData.get("role") ?? "member",
  });
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid invite.",
    };
  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;
  const { current } = await currentWorkspace(supabase, user.id);

  const { data: token, error } = await supabase.rpc("create_invite", {
    p_workspace_id: current.id,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error || !token) {
    if (error?.code === "42501")
      return { ok: false, error: "Only an owner can invite people." };
    const known = error?.message ? INVITE_ERRORS[error.message] : undefined;
    if (!known)
      log.error("invite.create_failed", {
        userId: user.id,
        code: error?.code ?? null,
      });
    return { ok: false, error: known ?? failed.error };
  }
  log.info("invite.created", {
    userId: user.id,
    workspaceId: current.id,
    role: parsed.data.role,
  });
  refresh();
  return {
    ok: true,
    data: { path: `/invite/${token}`, email: parsed.data.email },
  };
}

export async function revokeInvite(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase, user } = await getUserClient();
  if (!user) return;
  await supabase.from("invites").delete().eq("id", id.data);
  refresh();
}

export async function changeRole(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = memberRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid role." };
  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;
  const { current } = await currentWorkspace(supabase, user.id);

  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role: parsed.data.role })
    .eq("workspace_id", current.id)
    .eq("user_id", parsed.data.userId)
    .select("user_id");
  if (error?.code === "23514")
    return { ok: false, error: "A workspace needs at least one owner." };
  if (error) return failed;
  if (data.length === 0)
    return { ok: false, error: "Only an owner can change roles." };
  log.info("workspace.role_changed", {
    userId: user.id,
    workspaceId: current.id,
    memberId: parsed.data.userId,
    role: parsed.data.role,
  });
  refresh();
  return { ok: true, data: undefined };
}

export async function removeMember(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const memberId = z.uuid().safeParse(formData.get("userId"));
  if (!memberId.success) return { ok: false, error: "Invalid member." };
  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;
  const { current, all } = await currentWorkspace(supabase, user.id);

  const { data, error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", current.id)
    .eq("user_id", memberId.data)
    .select("user_id");
  if (error?.code === "23514")
    return { ok: false, error: "A workspace needs at least one owner." };
  if (error) return failed;
  if (data.length === 0) return { ok: false, error: VIEW_ONLY_MESSAGE };
  log.info("workspace.member_removed", {
    userId: user.id,
    workspaceId: current.id,
    memberId: memberId.data,
  });

  // Leaving: move to another workspace the user still belongs to.
  if (memberId.data === user.id) {
    const next = all.find((w) => w.id !== current.id);
    if (next) await setWorkspaceCookie(next.id);
    refresh();
    redirect("/tasks");
  }
  refresh();
  return { ok: true, data: undefined };
}

/**
 * Accepts an invite for the signed-in user (D-16), makes its workspace current
 * and opens the task list. The token comes from the URL: it's validated and
 * checked by accept_invite, never logged.
 */
export async function acceptInvite(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const token = inviteTokenSchema.safeParse(formData.get("token"));
  if (!token.success) return { ok: false, error: INVITE_ERRORS.invite_invalid };
  const { supabase, user } = await getUserClient();
  if (!user) return signedOut;

  const { data: workspaceId, error } = await supabase.rpc("accept_invite", {
    p_token: token.data,
  });
  if (error || !workspaceId) {
    const known = error?.message ? INVITE_ERRORS[error.message] : undefined;
    if (!known)
      log.error("invite.accept_failed", {
        userId: user.id,
        code: error?.code ?? null,
      });
    return { ok: false, error: known ?? failed.error };
  }
  log.info("invite.accepted", { userId: user.id, workspaceId });
  await setWorkspaceCookie(workspaceId);
  refresh();
  redirect("/tasks");
}
