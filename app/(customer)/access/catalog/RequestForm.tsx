"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { submitRequestAction, type RequestFormState } from "@/app/actions/requests";
import { Badge, Button, SelectField, TextareaField } from "@/modules/ui";
import { RISK_TONE, approvalPreview } from "./labels";

// ACCESS-P0-18 — the request form (spec §11.1): who it is for, what, for
// how long, why; the predicted risk and the approval it will meet, both
// computed by the server's rules; then the real outcome (§17.5).

const IDLE: RequestFormState = { status: "idle" };
const DURATIONS = [7, 14, 30, 90, 180, 365];

export type RequestOption = {
  value: string;
  label: string;
  risk: string;
  approval: string | null;
  maxDurationDays: number | null;
  defaultDurationDays: number | null;
  justificationRequired: boolean;
};

export function RequestForm({
  applicationId,
  options,
  initialOption,
  people,
  selfLabel,
}: {
  applicationId: string;
  options: RequestOption[];
  initialOption: string;
  people: { id: string; label: string }[];
  selfLabel: string;
}) {
  const [state, action, pending] = useActionState(submitRequestAction.bind(null, applicationId), IDLE);
  const [choice, setChoice] = useState(initialOption);
  const opt = options.find((o) => o.value === choice) ?? options[0];
  const durations = DURATIONS.filter((d) => opt.maxDurationDays === null || d <= opt.maxDurationDays);
  if (opt.maxDurationDays && !durations.includes(opt.maxDurationDays)) durations.push(opt.maxDurationDays);
  const defaultDuration = String(opt.defaultDurationDays ?? opt.maxDurationDays ?? "");

  return (
    <form action={action} className="space-y-4">
      <SelectField label="For" name="subjectIdentityId" defaultValue="">
        <option value="">{selfLabel}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </SelectField>
      <SelectField label="Access" name="entitlementId" value={choice} onChange={(e) => setChoice(e.target.value)}>
        {options.map((o) => (
          <option key={o.value || "app"} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectField>
      <SelectField key={`${choice}-duration`} label="For how long" name="durationDays" defaultValue={defaultDuration}>
        {opt.maxDurationDays === null ? <option value="">Until it is removed</option> : null}
        {durations.map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </SelectField>
      <TextareaField
        label={opt.justificationRequired ? "Why you need it" : "Why you need it (optional)"}
        name="justification"
        rows={3}
        maxLength={2000}
        required={opt.justificationRequired}
        hint={opt.justificationRequired ? "At least 10 characters. The approver reads this." : undefined}
      />
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <Badge tone={RISK_TONE[opt.risk]}>{opt.risk} risk</Badge>
        <span className="text-foreground">{approvalPreview(opt.approval, opt.risk)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !opt.approval}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Submitting…" : "Submit request"}
        </Button>
        <p role="status" className="text-sm">
          {state.status === "saved" ? (
            <span className="text-success">
              {state.message}{" "}
              <Link href="/access/requests?view=mine" className="font-medium underline">
                See my requests
              </Link>
            </span>
          ) : null}
          {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
        </p>
      </div>
    </form>
  );
}
