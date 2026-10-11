"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { submitRequestAction, type RequestFormState } from "@/app/actions/requests";
import { Button, SelectField, TextareaField } from "@/modules/ui";

const IDLE: RequestFormState = { status: "idle" };
const DURATIONS = [7, 14, 30, 90, 180, 365];

/**
 * ACCESS-P0-32 — asks to keep this access for longer: an `extend` request,
 * from today, approved like any other request. The server applies the
 * policy again, including its longest duration.
 */
export function ExtendForm({ applicationId, entitlementId, subjectIdentityId, maxDays }: { applicationId: string; entitlementId: string; subjectIdentityId: string; maxDays: number | null }) {
  const [state, action, pending] = useActionState(submitRequestAction.bind(null, applicationId), IDLE);
  const durations = DURATIONS.filter((d) => maxDays === null || d <= maxDays);
  if (maxDays && !durations.includes(maxDays)) durations.push(maxDays);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-primary">Extend</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="requestType" value="extend" />
        <input type="hidden" name="entitlementId" value={entitlementId} />
        <input type="hidden" name="subjectIdentityId" value={subjectIdentityId} />
        <SelectField label="Keep it for" name="durationDays" defaultValue={String(durations[0] ?? "")}>
          {maxDays === null ? <option value="">Until it is removed</option> : null}
          {durations.map((d) => (
            <option key={d} value={d}>
              {d} days from today
            </option>
          ))}
        </SelectField>
        <TextareaField label="Why it is still needed" name="justification" rows={2} maxLength={2000} required />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {pending ? "Submitting…" : "Ask to extend"}
          </Button>
          <p role="status" className="text-sm">
            {state.status === "saved" ? (
              <span className="text-success">
                {state.message}{" "}
                {state.requestId ? (
                  <Link href={`/access/requests/${state.requestId}`} className="font-medium underline">
                    Open it
                  </Link>
                ) : null}
              </span>
            ) : null}
            {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
          </p>
        </div>
      </form>
    </details>
  );
}
