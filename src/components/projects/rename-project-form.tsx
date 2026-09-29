"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { fieldClass, type ProjectAction } from "./types";

export function RenameProjectForm({
  action,
  id,
  name,
}: {
  action: ProjectAction;
  id: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1 text-sm">
        Name
        <div className="flex gap-2">
          <input
            name="name"
            defaultValue={name}
            required
            maxLength={100}
            className={`${fieldClass} flex-1`}
          />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Rename"}
          </Button>
        </div>
      </label>
      <p role="status" className="text-sm">
        {state?.ok
          ? "Saved."
          : state
            ? (state.fieldErrors?.name?.[0] ?? state.error)
            : null}
      </p>
    </form>
  );
}
