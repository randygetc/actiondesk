"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

import { fieldClass, type TaskAction } from "./types";

export function QuickAddForm({
  action,
  projectId,
}: {
  action: TaskAction;
  projectId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const error = state && !state.ok ? state : null;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      {projectId ? (
        <input type="hidden" name="projectId" value={projectId} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <input
          name="title"
          aria-label="New task title"
          placeholder="New task"
          required
          maxLength={200}
          className={`${fieldClass} min-w-48 flex-1`}
        />
        <input
          type="date"
          name="dueDate"
          aria-label="Due date"
          className={fieldClass}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add task"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.fieldErrors?.title?.[0] ??
            error.fieldErrors?.dueDate?.[0] ??
            error.error}
        </p>
      ) : null}
    </form>
  );
}
