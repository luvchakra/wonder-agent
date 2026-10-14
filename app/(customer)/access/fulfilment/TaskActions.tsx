"use client";

import { useActionState } from "react";
import { fulfilmentTaskAction, reassignTaskAction, type TaskFormState } from "@/app/actions/fulfilment";
import { Button } from "@/modules/ui";

const IDLE: TaskFormState = { status: "idle" };
const INPUT = "h-8 w-44 rounded-md border border-input bg-background px-2 text-xs text-foreground";

/**
 * ACCESS-P0-29 — one task's next step: Claim; once it is yours, Done (with
 * an optional note), and a problem reported from the folded row.
 */
export function TaskActions({ taskId, status, mine, label, connectorStatus = null }: { taskId: string; status: string; mine: boolean; label: string; connectorStatus?: string | null }) {
  const [state, action, pending] = useActionState(fulfilmentTaskAction.bind(null, taskId), IDLE);
  const outcome =
    state.status === "idle" ? null : (
      <p role="status" className={`text-xs ${state.status === "error" ? "text-destructive" : "text-success"}`}>
        {state.message}
      </p>
    );
  // INTEGRATION-P0-13: nobody touches the target while the connector is changing it.
  if (connectorStatus === "running" && status === "open") return outcome;
  if (status === "open" || status === "failed") {
    return (
      <div className="flex flex-col items-end gap-1">
        <form action={action}>
          <Button type="submit" name="action" value="claim" size="sm" variant="secondary" disabled={pending} aria-label={`Claim: ${label}`}>
            Claim
          </Button>
        </form>
        {connectorStatus === "failed" && status === "open" ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Connector</summary>
            <form action={action} className="mt-1">
              <Button type="submit" name="action" value="retry_connector" size="sm" variant="outline" disabled={pending} aria-label={`Try the connector again: ${label}`}>
                {pending ? "Trying…" : "Try again"}
              </Button>
            </form>
          </details>
        ) : null}
        {outcome}
      </div>
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

/**
 * ACCESS-P0-42 — hand a task to another person or group, with the reason.
 * Folded: most tasks are done by whoever they went to.
 */
export function ReassignTask({ taskId, label, choices }: { taskId: string; label: string; choices: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(reassignTaskAction.bind(null, taskId), IDLE);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Reassign</summary>
      <form action={action} className="mt-1 flex flex-wrap items-center justify-end gap-1.5">
        <select name="assignee" required aria-label={`Reassign to: ${label}`} className={INPUT} defaultValue="">
          <option value="" disabled>
            Person or group
          </option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input name="reason" required aria-label={`Why: ${label}`} placeholder="Why" maxLength={2000} className={INPUT} />
        <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`Reassign: ${label}`}>
          {pending ? "Reassigning…" : "Reassign"}
        </Button>
      </form>
      {state.status === "idle" ? null : (
        <p role="status" className={`mt-1 text-right ${state.status === "error" ? "text-destructive" : "text-success"}`}>
          {state.message}
        </p>
      )}
    </details>
  );
}
