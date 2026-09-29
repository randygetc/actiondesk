"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  action: (
    prev: ActionResult | null,
    formData: FormData,
  ) => Promise<ActionResult>;
  zones: readonly string[];
  displayName: string;
  timezone: string;
};

const fieldClass = "h-9 rounded-md border bg-background px-3 text-sm";

export function SettingsForm({ action, zones, displayName, timezone }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Display name
        <input
          name="displayName"
          defaultValue={displayName}
          maxLength={100}
          className={fieldClass}
        />
        {errors?.displayName ? (
          <span className="text-destructive">{errors.displayName[0]}</span>
        ) : null}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Time zone
        <select name="timezone" defaultValue={timezone} className={fieldClass}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        {errors?.timezone ? (
          <span className="text-destructive">{errors.timezone[0]}</span>
        ) : null}
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <p role="status" className="text-sm">
          {state?.ok ? "Saved." : state ? state.error : null}
        </p>
      </div>
    </form>
  );
}
