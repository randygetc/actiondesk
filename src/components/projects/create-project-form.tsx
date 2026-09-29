"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

import { fieldClass, type ProjectAction } from "./types";

export function CreateProjectForm({ action }: { action: ProjectAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          name="name"
          aria-label="New project name"
          placeholder="New project name"
          required
          maxLength={100}
          className={`${fieldClass} flex-1`}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add project"}
        </Button>
      </div>
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.fieldErrors?.name?.[0] ?? state.error}
        </p>
      ) : null}
    </form>
  );
}
