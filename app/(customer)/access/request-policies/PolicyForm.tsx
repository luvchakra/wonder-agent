"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { savePolicyAction, type RequestFormState } from "@/app/actions/requests";
import { Button, SelectField, TextField } from "@/modules/ui";

// ACCESS-P0-18 — create or update the request policy for one scope. The
// server validates every field and records the change (§17.5, #11).
// ACCESS-P0-19 adds how the approvers decide and what happens on timeout.

const IDLE: RequestFormState = { status: "idle" };

export type PolicyDefaults = {
  name: string;
  requestable: boolean;
  allowSelf: boolean;
  allowForOthers: string;
  maxDurationDays: number | null;
  defaultDurationDays: number | null;
  justificationRequired: boolean;
  riskThreshold: string;
  autoApprove: boolean;
  approval: string;
  approvalMode: string;
  approvalTimeoutDays: number;
  onTimeout: string;
  status: string;
};

export function PolicyForm({
  applicationId,
  entitlements,
  defaults,
}: {
  applicationId: string | null;
  entitlements: { id: string; name: string }[];
  defaults: PolicyDefaults;
}) {
  const [state, action, pending] = useActionState(savePolicyAction, IDLE);
  const check = (name: string, label: string, on: boolean) => (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input type="checkbox" name={name} defaultChecked={on} className="size-4 accent-primary" />
      {label}
    </label>
  );
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {applicationId ? <input type="hidden" name="applicationId" value={applicationId} /> : null}
      {applicationId ? (
        <SelectField label="Applies to" name="entitlementId" defaultValue="">
          <option value="">The whole application</option>
          {entitlements.map((e) => (
            <option key={e.id} value={e.id}>
              Only {e.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <p className="text-sm text-muted-foreground sm:col-span-2">The organization&apos;s default: it applies wherever no application or entitlement policy does.</p>
      )}
      <TextField label="Name" name="name" required maxLength={200} defaultValue={defaults.name} />
      <SelectField label="Requesting for someone else" name="allowForOthers" defaultValue={defaults.allowForOthers}>
        <option value="managers">Their manager or an access manager</option>
        <option value="access_managers">Only access managers</option>
        <option value="none">Nobody (self only)</option>
      </SelectField>
      <SelectField label="Approval route" name="approval" defaultValue={defaults.approval}>
        <option value="manager_approval">Manager</option>
        <option value="owner_approval">Owner (entitlement, else application)</option>
        <option value="manager_and_owner">Manager and owner</option>
      </SelectField>
      <SelectField label="Manager and owner decide" name="approvalMode" defaultValue={defaults.approvalMode} hint="Only for the manager-and-owner route">
        <option value="sequential">In order: manager, then owner</option>
        <option value="parallel">At the same time</option>
      </SelectField>
      <TextField label="Days each approver has" name="approvalTimeoutDays" type="number" min={1} max={60} required defaultValue={defaults.approvalTimeoutDays} />
      <SelectField label="When an approver does not decide in time" name="onTimeout" defaultValue={defaults.onTimeout}>
        <option value="escalate">Escalate to access managers once, then expire</option>
        <option value="expire">Expire the request</option>
      </SelectField>
      <TextField label="Longest duration (days)" name="maxDurationDays" type="number" min={1} max={3650} defaultValue={defaults.maxDurationDays ?? ""} hint="Empty: no limit" />
      <TextField label="Default duration (days)" name="defaultDurationDays" type="number" min={1} max={3650} defaultValue={defaults.defaultDurationDays ?? ""} />
      <SelectField label="Always needs approval from risk" name="riskThreshold" defaultValue={defaults.riskThreshold}>
        <option value="low">Low (every request)</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </SelectField>
      <SelectField label="Status" name="status" defaultValue={defaults.status}>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </SelectField>
      <fieldset className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-2">
        <legend className="sr-only">Rules</legend>
        {check("requestable", "Requestable", defaults.requestable)}
        {check("allowSelf", "People may request for themselves", defaults.allowSelf)}
        {check("justificationRequired", "A justification is required", defaults.justificationRequired)}
        {check("autoApprove", "Approve automatically below the risk threshold", defaults.autoApprove)}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : "Save policy"}
        </Button>
        <p role="status" className="text-xs">
          {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
          {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
        </p>
      </div>
    </form>
  );
}
