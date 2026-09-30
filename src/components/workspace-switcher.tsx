"use client";

import { useRef } from "react";

type Workspace = {
  id: string;
  name: string;
  role: "owner" | "member" | "viewer";
};

/** A form post, so it works before hydration; JS submits on change. */
export function WorkspaceSwitcher({
  workspaces,
  currentId,
  action,
}: {
  workspaces: Workspace[];
  currentId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      action={action}
      className="flex items-center gap-2 text-sm"
    >
      <label htmlFor="workspace" className="sr-only">
        Workspace
      </label>
      <select
        id="workspace"
        name="workspaceId"
        defaultValue={currentId}
        onChange={() => form.current?.requestSubmit()}
        className="h-8 rounded-md border bg-background px-2 text-sm"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {w.role === "viewer" ? " (view only)" : ""}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit">Switch</button>
      </noscript>
    </form>
  );
}
