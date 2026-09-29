"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { log } from "@/lib/log";
// DELIBERATE VIOLATION (step 1.4, #2): admin client in a Server Action. Do not merge.
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { updateProfileSchema } from "@/lib/validation/profile";

export async function updateProfile(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse({
    displayName: formData.get("displayName") ?? "",
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  void createAdminClient;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      timezone: parsed.data.timezone,
    })
    .eq("id", user.id);

  if (error) {
    log.warn("profile.update_failed", { userId: user.id, code: error.code });
    if (error.code === "22023") {
      return {
        ok: false,
        error: "Unknown time zone.",
        fieldErrors: { timezone: ["Unknown time zone"] },
      };
    }
    return {
      ok: false,
      error: "Couldn't save your settings. Please try again.",
    };
  }

  log.info("profile.updated", { userId: user.id });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
