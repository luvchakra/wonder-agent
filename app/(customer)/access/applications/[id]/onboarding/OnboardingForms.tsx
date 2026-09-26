"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import {
  applicationLifecycleAction,
  configureOnboardingAction,
  onboardingStepAction,
  startOnboardingAction,
  type ApplicationFormState,
} from "@/app/actions/applications";
import { Button, SelectField, TextField, TextareaField } from "@/modules/ui";
import {
  CERTIFICATION_POLICY_LABEL,
  CORRELATION_IDENTITY_LABEL,
  ONBOARDING_MODES,
  ONBOARDING_OPERATION_LABEL,
  REQUEST_POLICY_LABEL,
} from "../../labels";

// ACCESS-P0-16 — onboarding forms. Each shows the server's real result
// (§17.5): a step that failed or was refused says so and why.

const IDLE: ApplicationFormState = { status: "idle" };

function Result({ state }: { state: ApplicationFormState }) {
  return (
    <p role="status" className="min-h-5 text-xs">
      {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
      {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
    </p>
  );
}

function Pending({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? busy : idle}
    </>
  );
}

export function StartOnboardingForm({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(startOnboardingAction.bind(null, applicationId), IDLE);
  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-foreground">How much guidance?</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
          {ONBOARDING_MODES.map((m) => (
            <label key={m.value} className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="mode" value={m.value} defaultChecked={m.value === "assisted"} className="mt-0.5 size-4 accent-primary" />
              <span>
                <span className="block text-sm font-medium text-foreground">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Pending pending={pending} idle="Start onboarding" busy="Starting…" />
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export type OnboardingConfigView = {
  integrationId: string | null;
  accountIdentifierField: string | null;
  correlation: { accountField: string; identityField: keyof typeof CORRELATION_IDENTITY_LABEL } | null;
  entitlementSource: "connector" | "manual" | null;
  operations: Record<keyof typeof ONBOARDING_OPERATION_LABEL, boolean>;
  requestPolicy: keyof typeof REQUEST_POLICY_LABEL | null;
  certificationPolicy: keyof typeof CERTIFICATION_POLICY_LABEL | null;
  provenanceEnabled: boolean;
};

export function ConfigureOnboardingForm({
  applicationId,
  config,
  configVersion,
  integrations,
  disabled,
}: {
  applicationId: string;
  config: OnboardingConfigView;
  configVersion: number;
  integrations: { id: string; name: string }[];
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(configureOnboardingAction.bind(null, applicationId), IDLE);
  const linked = config.integrationId && !integrations.some((i) => i.id === config.integrationId);
  return (
    <form action={action}>
      <input type="hidden" name="configVersion" value={configVersion} />
      <fieldset disabled={disabled || pending} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField label="Connector" name="integrationId" defaultValue={config.integrationId ?? ""} hint="Accounts and entitlements are read from it">
          <option value="">Not connected (manual)</option>
          {linked ? <option value={config.integrationId!}>The linked integration</option> : null}
          {integrations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Entitlements come from" name="entitlementSource" defaultValue={config.entitlementSource ?? ""}>
          <option value="">Choose…</option>
          <option value="connector">The connector</option>
          <option value="manual">Manual entry</option>
        </SelectField>
        <TextField
          label="Account identifier field"
          name="accountIdentifierField"
          maxLength={100}
          defaultValue={config.accountIdentifierField ?? ""}
          placeholder="externalId"
          hint="The field that uniquely identifies an account"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Match account field" name="correlationAccountField" maxLength={100} defaultValue={config.correlation?.accountField ?? ""} placeholder="email" />
          <SelectField label="To identity field" name="correlationIdentityField" defaultValue={config.correlation?.identityField ?? "email"}>
            {Object.entries(CORRELATION_IDENTITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </SelectField>
        </div>
        <SelectField label="Request policy" name="requestPolicy" defaultValue={config.requestPolicy ?? ""}>
          <option value="">Choose…</option>
          {Object.entries(REQUEST_POLICY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
        <SelectField label="Certification" name="certificationPolicy" defaultValue={config.certificationPolicy ?? ""}>
          <option value="">Choose…</option>
          {Object.entries(CERTIFICATION_POLICY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
        <fieldset className="sm:col-span-2">
          <legend className="text-xs font-medium text-muted-foreground">Operations to fulfil through the connector</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3">
            {Object.entries(ONBOARDING_OPERATION_LABEL).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" name={k} defaultChecked={config.operations[k as keyof typeof ONBOARDING_OPERATION_LABEL]} className="size-4 accent-primary" />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
          <input type="checkbox" name="provenanceEnabled" defaultChecked={config.provenanceEnabled} className="size-4 accent-primary" />
          Audit every change with its source (required)
        </label>
        {!disabled ? (
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              <Pending pending={pending} idle="Save configuration" busy="Saving…" />
            </Button>
            <Result state={state} />
            <span className="text-xs text-muted-foreground">Saving a change means validating, simulating and approving again.</span>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}

/** One onboarding step behind one button. */
export function StepForm({
  applicationId,
  step,
  label,
  busy,
  disabledReason,
  variant = "default",
}: {
  applicationId: string;
  step: "validate" | "simulate" | "promote";
  label: string;
  busy: string;
  disabledReason: string | null;
  variant?: "default" | "outline";
}) {
  const [state, action, pending] = useActionState(onboardingStepAction.bind(null, applicationId), IDLE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="step" value={step} />
      <Button type="submit" variant={variant} disabled={pending || Boolean(disabledReason)}>
        <Pending pending={pending} idle={label} busy={busy} />
      </Button>
      {disabledReason && state.status === "idle" ? <span className="text-xs text-muted-foreground">{disabledReason}</span> : <Result state={state} />}
    </form>
  );
}

/** Approve or reject what someone else submitted. */
export function DecisionForm({ applicationId, ownSubmission }: { applicationId: string; ownSubmission: boolean }) {
  const [state, action, pending] = useActionState(onboardingStepAction.bind(null, applicationId), IDLE);
  return (
    <form action={action} className="space-y-3">
      <TextareaField label="Note" name="note" rows={2} maxLength={2000} hint="Required to reject" />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" name="step" value="approve" disabled={pending || ownSubmission}>
          <Pending pending={pending} idle="Approve" busy="Recording…" />
        </Button>
        <Button type="submit" name="step" value="reject" variant="outline" disabled={pending}>
          Reject
        </Button>
        {ownSubmission && state.status === "idle" ? (
          <span className="text-xs text-muted-foreground">You submitted this; someone else must approve it.</span>
        ) : (
          <Result state={state} />
        )}
      </div>
    </form>
  );
}

/** Suspend, resume or retire a live application. */
export function LifecycleForm({ applicationId, actions }: { applicationId: string; actions: ("suspend" | "resume" | "retire")[] }) {
  const [state, action, pending] = useActionState(applicationLifecycleAction.bind(null, applicationId), IDLE);
  const label = { suspend: "Suspend", resume: "Resume", retire: "Retire" } as const;
  return (
    <form action={action} className="space-y-3">
      <TextField label="Reason" name="note" maxLength={2000} hint="Required to suspend or retire" />
      <div className="flex flex-wrap items-center gap-3">
        {actions.map((a) => (
          <Button key={a} type="submit" name="lifecycle" value={a} variant={a === "retire" ? "destructive" : "outline"} disabled={pending}>
            {label[a]}
          </Button>
        ))}
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
        <Result state={state} />
      </div>
    </form>
  );
}
