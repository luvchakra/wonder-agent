"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { cancelRequestAction, decideRequestAction, type RequestFormState } from "@/app/actions/requests";
import { Button } from "@/modules/ui";

// ACCESS-P0-18 — the actions on one request row; each shows the server's
// real outcome (§17.5), including a refusal such as self-approval.

const IDLE: RequestFormState = { status: "idle" };

function Result({ state }: { state: RequestFormState }) {
  if (state.status === "idle") return null;
  return (
    <p role="status" className={`mt-1 text-xs ${state.status === "error" ? "text-destructive" : "text-success"}`}>
      {state.message}
    </p>
  );
}

export function RequestActions({
  requestId,
  catalog,
  canCancel,
  canDecide,
  canFulfil,
  withComment = false,
}: {
  requestId: string;
  /** ACCESS-P0-19: a catalog request is decided one approval step at a time. */
  catalog: boolean;
  canCancel: boolean;
  canDecide: boolean;
  canFulfil: boolean;
  withComment?: boolean;
}) {
  const [decided, decide, deciding] = useActionState(decideRequestAction.bind(null, requestId, catalog), IDLE);
  const [cancelled, cancel, cancelling] = useActionState(cancelRequestAction.bind(null, requestId), IDLE);
  const pending = deciding || cancelling;
  // After a decision the page re-renders without these actions: keep the outcome visible.
  if (!canCancel && !canDecide && !canFulfil)
    return decided.status !== "idle" || cancelled.status !== "idle" ? <Result state={decided.status !== "idle" ? decided : cancelled} /> : null;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {canDecide ? (
          <form action={decide} className={withComment ? "w-full space-y-2" : "flex gap-2"}>
            {withComment ? (
              <div>
                <label htmlFor={`comment-${requestId}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                  Comment (optional)
                </label>
                <textarea
                  id={`comment-${requestId}`}
                  name="comment"
                  rows={2}
                  maxLength={2000}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" name="decision" value="approved" size="sm" disabled={pending}>
                {deciding ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
                Approve
              </Button>
              <Button type="submit" name="decision" value="rejected" size="sm" variant="outline" disabled={pending}>
                Reject
              </Button>
            </div>
          </form>
        ) : null}
        {canFulfil ? (
          <form action={decide}>
            <Button type="submit" name="decision" value="fulfilled" size="sm" variant="secondary" disabled={pending}>
              Mark fulfilled
            </Button>
          </form>
        ) : null}
        {canCancel ? (
          <form action={cancel}>
            <Button type="submit" size="sm" variant="ghost" disabled={pending}>
              {cancelling ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
              Cancel request
            </Button>
          </form>
        ) : null}
      </div>
      <Result state={decided.status !== "idle" ? decided : cancelled} />
    </div>
  );
}
