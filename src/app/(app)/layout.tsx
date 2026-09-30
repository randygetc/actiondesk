import Link from "next/link";

import { AskPanel } from "@/components/ask/ask-panel";
import { WorkspaceLive } from "@/components/realtime/workspace-live";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { Button } from "@/components/ui/button";
import { askStream, confirmCreateTask } from "@/app/(app)/ask/actions";
import { signOut } from "@/app/auth/signout/actions";
import { requireUser } from "@/lib/auth/user";
import { currentWorkspace } from "@/lib/workspace/current";

import { setWorkspace } from "./workspace/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { supabase, user } = await requireUser();
  const { current, all } = await currentWorkspace(supabase, user.id);
  // Only decides whether to show the link; the page itself is gated by RLS.
  const { data: isAdmin } = await supabase.rpc("is_app_admin");

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <span className="font-semibold">ActionDesk</span>
        <WorkspaceSwitcher
          workspaces={all}
          currentId={current.id}
          action={setWorkspace}
        />
        {/* Keyed so switching workspaces rejoins the right channel. */}
        <WorkspaceLive key={current.id} workspaceId={current.id} />
        <nav className="flex gap-4 text-sm">
          <Link href="/tasks">Tasks</Link>
          <Link href="/capture">Capture</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/workspace">Workspace</Link>
          <Link href="/settings">Settings</Link>
          {isAdmin ? <Link href="/admin/usage">Usage</Link> : null}
        </nav>
        <div className="ml-auto">
          <AskPanel
            askStream={askStream}
            confirmCreateTask={confirmCreateTask}
          />
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
