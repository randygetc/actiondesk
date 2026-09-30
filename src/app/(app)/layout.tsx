import Link from "next/link";

import { AskPanel } from "@/components/ask/ask-panel";
import { Button } from "@/components/ui/button";
import { askStream, confirmCreateTask } from "@/app/(app)/ask/actions";
import { signOut } from "@/app/auth/signout/actions";
import { requireUser } from "@/lib/auth/user";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <span className="font-semibold">ActionDesk</span>
        <nav className="flex gap-4 text-sm">
          <Link href="/tasks">Tasks</Link>
          <Link href="/capture">Capture</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/settings">Settings</Link>
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
