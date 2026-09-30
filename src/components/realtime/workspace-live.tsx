"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/** Coalesces bursts (a capture saving 20 tasks) into one refresh. */
const REFRESH_DELAY_MS = 250;

/**
 * Live updates for the current workspace (step 3.4). Joins the private
 * Broadcast channel `workspace:<id>`; members only (RLS on realtime.messages).
 * A message says only that something changed, so the page re-renders from the
 * server through RLS. Rows are never merged here, so an optimistic update and
 * the realtime echo can't produce duplicates.
 *
 * Catching up: after a reconnect (laptop sleep, network loss) or when the tab
 * becomes visible again, refresh once, since events may have been missed.
 */
export function WorkspaceLive({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let missedSomething = false;
    let stopped = false;

    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
    };

    const channel = supabase.channel(`workspace:${workspaceId}`, {
      config: { private: true },
    });
    channel.on("broadcast", { event: "*" }, refresh);

    // Private channels need the user's token before joining.
    void supabase.realtime.setAuth().then(() => {
      if (stopped) return;
      channel.subscribe((s) => {
        if (s === "SUBSCRIBED") {
          setStatus("live");
          if (missedSomething) refresh();
          missedSomething = false;
        } else {
          setStatus("offline");
          missedSomething = true;
        }
      });
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, router]);

  return (
    // An image with a label, not role="status": announcing every reconnect
    // would be noise, and pages keep role="status" for their own messages.
    <span
      role="img"
      aria-label={
        status === "live" ? "Live updates on" : "Live updates reconnecting"
      }
      title={status === "live" ? "Live" : "Reconnecting…"}
      data-live={status}
      className={`size-2 rounded-full ${status === "live" ? "bg-green-500" : "bg-amber-500"}`}
    />
  );
}
