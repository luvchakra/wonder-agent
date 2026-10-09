"use client";

import { useActionState } from "react";
import { renameOrganizationAction, type RenameOrganizationState } from "@/app/actions/tenant";
import { PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

const initial: RenameOrganizationState = { ok: false, message: null };

/** Renames the organization; shows the server's answer as given. */
export function OrganizationNameForm({ name }: { name: string }) {
  const [state, action] = useActionState(renameOrganizationAction, initial);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="organization-name" className={fieldLabelClass}>
          Organization name
        </label>
        <input id="organization-name" name="name" required minLength={2} maxLength={80} defaultValue={name} className={cn(fieldInputClass, "max-w-md")} />
      </div>
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={cn(
            "max-w-md rounded-md border px-3 py-2 text-sm",
            state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {state.message}
        </p>
      ) : null}
      <PendingSubmitButton size="sm" pendingLabel="Saving…">
        Save name
      </PendingSubmitButton>
    </form>
  );
}
