import { CapturePanel } from "@/components/capture/capture-panel";
import { requireUser } from "@/lib/auth/user";
import { isFakeLlm } from "@/lib/llm";
import { currentWorkspace } from "@/lib/workspace/current";

import {
  discardAttachment,
  extractFromAttachment,
  extractFromText,
  saveReviewedTasks,
  uploadAttachment,
} from "./actions";

export default async function CapturePage() {
  const { supabase, user } = await requireUser();
  const { current } = await currentWorkspace(supabase, user.id);
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", current.id)
    .is("archived_at", null)
    .order("name");

  return (
    // data-llm lets e2e tests confirm the fake model is active before running.
    <div
      className="mx-auto flex max-w-3xl flex-col gap-6"
      data-llm={isFakeLlm() ? "fake" : "live"}
    >
      <div>
        <h1 className="text-2xl font-semibold">Capture</h1>
        <p className="text-sm text-muted-foreground">
          Paste meeting notes, an email or a chat thread. Review what&apos;s
          found before anything is saved.
        </p>
      </div>
      <CapturePanel
        extract={extractFromText}
        extractFile={extractFromAttachment}
        upload={uploadAttachment}
        discard={discardAttachment}
        save={saveReviewedTasks}
        projects={projects ?? []}
      />
    </div>
  );
}
