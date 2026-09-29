"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/** Server Actions are POST-only, so sign-out can't be triggered by a link or GET. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
