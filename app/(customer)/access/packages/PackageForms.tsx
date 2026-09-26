"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import {
  addResourceAction,
  assignDirectAction,
  itemStatusAction,
  removeResourceAction,
  requestPackageAction,
  revokeAssignmentAction,
  savePackageAction,
  setPackageStatusAction,
  type PackageFormState,
} from "@/app/actions/packages";
import { Button, SelectField, TextField, TextareaField } from "@/modules/ui";

// ACCESS-P0-20 — access package forms. Each shows the server's real
// outcome (§17.5): a refusal says why, and nothing is shown as done that
// the server did not do.

const IDLE: PackageFormState = { status: "idle" };
const DURATIONS = [7, 14, 30, 90, 180, 365];

function Outcome({ state }: { state: PackageFormState }) {
  if (state.status === "idle") return null;
  return (
    <p role="status" className={`text-xs ${state.status === "error" ? "text-destructive" : "text-success"}`}>
      {state.message}
    </p>
  );
}

function Submit({ pending, children, variant, size }: { pending: boolean; children: React.ReactNode; variant?: "outline" | "secondary" | "ghost"; size?: "sm" }) {
  return (
    <Button type="submit" disabled={pending} variant={variant} size={size}>
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

export type PackageDefaults = {
  name: string;
  description: string | null;
  ownerIdentityId: string | null;
  eligibleIdentityTypes: string[];
  eligibleDepartments: string[];
  approval: string;
  approvalMode: string;
  approvalTimeoutDays: number;
  onTimeout: string;
  maxDurationDays: number | null;
  defaultDurationDays: number | null;
  certificationFrequency: string;
  requestable: boolean;
  extensionAllowed: boolean;
};

const TYPES: [string, string][] = [
  ["HUMAN", "People"],
  ["EXTERNAL", "External identities"],
  ["MACHINE", "Machine identities"],
  ["AI_AGENT", "AI agents"],
];

export function PackageForm({ packageId, defaults, people }: { packageId: string | null; defaults: PackageDefaults; people: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(savePackageAction.bind(null, packageId), IDLE);
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField label="Name" name="name" required maxLength={200} defaultValue={defaults.name} />
      <SelectField label="Owner" name="ownerIdentityId" defaultValue={defaults.ownerIdentityId ?? ""} hint="Approves requests when the route includes the owner">
        <option value="">No owner yet</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </SelectField>
      <div className="sm:col-span-2">
        <TextareaField label="What it is for" name="description" rows={2} maxLength={2000} defaultValue={defaults.description ?? ""} />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium text-foreground">Who it is for</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {TYPES.map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="eligibleIdentityTypes" value={value} defaultChecked={defaults.eligibleIdentityTypes.includes(value)} className="size-4 accent-primary" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <TextField label="Only these departments" name="eligibleDepartments" defaultValue={defaults.eligibleDepartments.join(", ")} hint="Comma-separated, exact names. Empty: every department." />
      <SelectField label="Certified" name="certificationFrequency" defaultValue={defaults.certificationFrequency}>
        <option value="quarterly">Quarterly</option>
        <option value="semiannual">Every six months</option>
        <option value="annual">Annually</option>
        <option value="none">Not certified</option>
      </SelectField>
      <SelectField label="Approval route" name="approval" defaultValue={defaults.approval}>
        <option value="manager_approval">Manager</option>
        <option value="owner_approval">Package owner</option>
        <option value="manager_and_owner">Manager and package owner</option>
      </SelectField>
      <SelectField label="Manager and owner decide" name="approvalMode" defaultValue={defaults.approvalMode}>
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
      <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="requestable" defaultChecked={defaults.requestable} className="size-4 accent-primary" />
          Eligible identities can find and request it
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="extensionAllowed" defaultChecked={defaults.extensionAllowed} className="size-4 accent-primary" />
          Assignments may be extended
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Submit pending={pending}>{packageId ? "Save package" : "Create package"}</Submit>
        <Outcome state={state} />
        {state.status === "saved" && !packageId && state.id ? (
          <a href={`/access/packages/${state.id}`} className="text-xs font-medium text-primary hover:underline">
            Open it
          </a>
        ) : null}
      </div>
    </form>
  );
}

export function StatusButtons({ packageId, status }: { packageId: string; status: string }) {
  const [activated, activate, activating] = useActionState(setPackageStatusAction.bind(null, packageId, "active"), IDLE);
  const [retired, retire, retiring] = useActionState(setPackageStatusAction.bind(null, packageId, "retired"), IDLE);
  const state = activated.status !== "idle" ? activated : retired;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {status !== "active" && status !== "retired" ? (
          <form action={activate}>
            <Submit pending={activating} size="sm">
              Activate
            </Submit>
          </form>
        ) : null}
        {status !== "retired" ? (
          <form action={retire}>
            <Submit pending={retiring} size="sm" variant="outline">
              Retire
            </Submit>
          </form>
        ) : null}
      </div>
      <Outcome state={state} />
    </div>
  );
}

export function ResourceForm({ packageId, applications, selectedApp, entitlements }: { packageId: string; applications: { id: string; name: string }[]; selectedApp: string | null; entitlements: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addResourceAction.bind(null, packageId), IDLE);
  return (
    <div className="space-y-3">
      <form method="get" className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <SelectField label="Application" name="app" defaultValue={selectedApp ?? ""}>
            <option value="">Choose a live application</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
        </div>
        <Button type="submit" variant="secondary">
          Choose
        </Button>
      </form>
      {selectedApp ? (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="applicationId" value={selectedApp} />
          <div className="min-w-0 flex-1">
            <SelectField label="Include" name="entitlementId" defaultValue="">
              <option value="">The application itself</option>
              {entitlements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </SelectField>
          </div>
          <Submit pending={pending}>Add to package</Submit>
        </form>
      ) : null}
      <Outcome state={state} />
    </div>
  );
}

export function RemoveResource({ packageId, resourceId, label }: { packageId: string; resourceId: string; label: string }) {
  const [state, action, pending] = useActionState(removeResourceAction.bind(null, packageId, resourceId), IDLE);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${label}`}>
        {pending ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
        Remove
      </Button>
      {state.status === "error" ? <Outcome state={state} /> : null}
    </form>
  );
}

export function PackageRequestForm({
  packageId,
  people,
  selfLabel,
  maxDurationDays,
  defaultDurationDays,
}: {
  packageId: string;
  people: { id: string; label: string }[];
  selfLabel: string;
  maxDurationDays: number | null;
  defaultDurationDays: number | null;
}) {
  const [state, action, pending] = useActionState(requestPackageAction.bind(null, packageId), IDLE);
  const durations = DURATIONS.filter((d) => maxDurationDays === null || d <= maxDurationDays);
  if (maxDurationDays && !durations.includes(maxDurationDays)) durations.push(maxDurationDays);
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
      <SelectField label="For how long" name="durationDays" defaultValue={String(defaultDurationDays ?? maxDurationDays ?? "")}>
        {maxDurationDays === null ? <option value="">Until it is removed</option> : null}
        {durations.map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </SelectField>
      <TextareaField label="Why it is needed" name="justification" rows={3} maxLength={2000} required hint="At least 10 characters. The approvers read this." />
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending}>Request package</Submit>
        <Outcome state={state} />
        {state.status === "saved" && state.id ? (
          <a href={`/access/requests/${state.id}`} className="text-xs font-medium text-primary hover:underline">
            Follow the request
          </a>
        ) : null}
      </div>
    </form>
  );
}

export function AssignForm({ packageId, candidates, maxDurationDays }: { packageId: string; candidates: { id: string; label: string }[]; maxDurationDays: number | null }) {
  const [state, action, pending] = useActionState(assignDirectAction.bind(null, packageId), IDLE);
  const durations = DURATIONS.filter((d) => maxDurationDays === null || d <= maxDurationDays);
  return (
    <form action={action} className="space-y-3">
      <SelectField label="Assign to" name="identityId" required defaultValue="">
        <option value="" disabled>
          {candidates.length ? "Choose an identity" : "Find someone above first"}
        </option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </SelectField>
      <SelectField label="For how long" name="durationDays" defaultValue="">
        <option value="">{maxDurationDays ? "The package default" : "Until it is removed"}</option>
        {durations.map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </SelectField>
      <TextareaField label="Why it is assigned" name="justification" rows={2} maxLength={2000} required hint="At least 10 characters; recorded in the audit trail." />
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} variant="secondary">
          Assign directly
        </Submit>
        <Outcome state={state} />
      </div>
    </form>
  );
}

export function ItemActions({ packageId, itemId, status, label }: { packageId: string; itemId: string; status: string; label: string }) {
  const [state, action, pending] = useActionState(itemStatusAction.bind(null, packageId, itemId), IDLE);
  if (!["pending", "failed", "revoke_pending"].includes(status)) return state.status !== "idle" ? <Outcome state={state} /> : null;
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-1.5">
      {status === "revoke_pending" ? (
        <Button type="submit" name="status" value="revoked" size="sm" variant="secondary" disabled={pending} aria-label={`Removed: ${label}`}>
          Mark removed
        </Button>
      ) : (
        <>
          <input name="detail" aria-label={`What happened: ${label}`} placeholder="What happened" maxLength={1000} className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
          <Button type="submit" name="status" value="fulfilled" size="sm" variant="secondary" disabled={pending} aria-label={`Done: ${label}`}>
            Done
          </Button>
          {status === "pending" ? (
            <Button type="submit" name="status" value="failed" size="sm" variant="outline" disabled={pending} aria-label={`Failed: ${label}`}>
              Failed
            </Button>
          ) : null}
        </>
      )}
      <div className="w-full text-right">
        <Outcome state={state} />
      </div>
    </form>
  );
}

export function RevokeForm({ packageId, assignmentId }: { packageId: string; assignmentId: string }) {
  const [state, action, pending] = useActionState(revokeAssignmentAction.bind(null, packageId, assignmentId), IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input name="reason" required minLength={5} maxLength={2000} placeholder="Why it is revoked" aria-label="Why it is revoked" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
      <Submit pending={pending} size="sm" variant="outline">
        Revoke
      </Submit>
      <div className="w-full">
        <Outcome state={state} />
      </div>
    </form>
  );
}
