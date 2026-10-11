"use client";

import { useActionState } from "react";
import { fulfilmentTaskAction, type TaskFormState } from "@/app/actions/fulfilment";
import { Button } from "@/modules/ui";

const IDLE: TaskFormState = { status: "idle" };
const INPUT = "h-8 w-44 rounded-md border border-input bg-background px-2 text-xs text-foreground";

/**
 * ACCESS-P0-29 — one task's next step: Claim; once it is yours, Done (with
 * an optional note), and a problem reported from the folded row.
 */
export function TaskActions({ taskId, status, mine, label }: { taskId: string; status: string; mine: boolean; label: string }) {
  const [state, action, pending] = useActionState(fulfilmentTaskAction.bind(null, taskId), IDLE);
  const outcome =
    state.status === "idle" ? null : (
      <p role="status" className={`text-xs ${state.status === "error" ? "text-destructive" : "text-success"}`}>
        {state.message}
      </p>
    );
  if (status === "open" || status === "failed") {
    return (
      <form action={action} className="flex flex-col items-end gap-1">
        <Button type="submit" name="action" value="claim" size="sm" variant="secondary" disabled={pending} aria-label={`Claim: ${label}`}>
          Claim
        </Button>
        {outcome}
      </form>
    );
  }
  if (status !== "claimed" || !mine) return outcome;
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action} className="flex items-center gap-1.5">
        <input type="hidden" name="action" value="complete" />
        <input name="note" aria-label={`Note: ${label}`} placeholder="What was done (optional)" maxLength={2000} className={INPUT} />
        <Button type="submit" size="sm" variant="secondary" disabled={pending} aria-label={`Done: ${label}`}>
          Done
        </Button>
      </form>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Report a problem</summary>
        <form action={action} className="mt-1 flex items-center gap-1.5">
          <input type="hidden" name="action" value="fail" />
          <input name="note" required aria-label={`What failed: ${label}`} placeholder="What failed" maxLength={2000} className={INPUT} />
          <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`Failed: ${label}`}>
            Failed
          </Button>
        </form>
      </details>
      {outcome}
    </div>
  );
}
