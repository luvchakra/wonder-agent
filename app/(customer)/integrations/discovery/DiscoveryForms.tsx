"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { decideDiscoveryAction, discoverFromIntegrationAction, submitDiscoveryAction, type DiscoveryFormState } from "@/app/actions/discovery";
import { Button, SelectField, TextField, TextareaField } from "@/modules/ui";

// INTEGRATION-P0-10 — discovery forms; each shows the server's real
// result (§17.5).

const IDLE: DiscoveryFormState = { status: "idle" };

function Result({ state }: { state: DiscoveryFormState }) {
  return (
    <p role="status" className="min-h-5 text-xs">
      {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
      {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
    </p>
  );
}

function Submit({ pending, idle, busy, variant = "default" }: { pending: boolean; idle: string; busy: string; variant?: "default" | "outline" | "destructive" | "secondary" }) {
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? busy : idle}
    </Button>
  );
}

export function DiscoverFromConnectorForm({ integrations }: { integrations: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(discoverFromIntegrationAction, IDLE);
  if (!integrations.length) return <p className="text-sm text-muted-foreground">No connectors yet. Applications a connector imports can be discovered once one is set up.</p>;
  return (
    <form action={action} className="space-y-3">
      <SelectField label="Connector" name="integrationId" defaultValue={integrations[0].id}>
        {integrations.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} idle="Discover applications" busy="Reading…" />
        <Result state={state} />
      </div>
      <p className="text-xs text-muted-foreground">Reads the applications the connector already imported. Nothing in the connected system changes.</p>
    </form>
  );
}

export function SubmitDiscoveryForm() {
  const [kind, setKind] = useState<"openapi" | "scim" | "manual">("openapi");
  const [state, action, pending] = useActionState(submitDiscoveryAction, IDLE);
  return (
    <form action={action} className="space-y-3">
      <SelectField label="From" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        <option value="openapi">An OpenAPI document</option>
        <option value="scim">SCIM service-provider metadata</option>
        <option value="manual">A manual report</option>
      </SelectField>
      {kind === "openapi" ? (
        <TextareaField label="OpenAPI document (JSON)" name="document" rows={6} required hint="OpenAPI 3 or Swagger 2, up to 1 MB. Addresses in it are recorded, never called." className="font-mono text-xs" />
      ) : null}
      {kind === "scim" ? (
        <>
          <TextField label="Application name" name="name" required maxLength={200} />
          <TextField label="SCIM base address" name="baseUrl" type="url" required placeholder="https://" hint="https only" />
          <TextareaField label="ServiceProviderConfig (JSON)" name="metadata" rows={5} required className="font-mono text-xs" />
        </>
      ) : null}
      {kind === "manual" ? (
        <>
          <TextField label="Application name" name="name" required maxLength={200} />
          <TextField label="Vendor" name="vendor" maxLength={200} />
          <TextField label="Address" name="url" type="url" placeholder="https://" hint="https only" />
          <TextareaField label="Where it was seen" name="description" rows={2} maxLength={2000} />
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} idle="Record discovery" busy="Recording…" />
        <Result state={state} />
      </div>
    </form>
  );
}

type Option = { id: string; label: string };

/** Register, link, record an exception or ignore — one form per decision. */
export function DecisionForms({
  discoveryId,
  name,
  allowed,
  canManageCatalog,
  canConnect,
  people,
  applications,
  suggestedApplicationId,
  appTypes,
  levels,
  classifications,
}: {
  discoveryId: string;
  name: string;
  allowed: ("register" | "link" | "exception" | "ignore" | "reopen")[];
  canManageCatalog: boolean;
  canConnect: boolean;
  people: Option[];
  applications: Option[];
  suggestedApplicationId: string | null;
  appTypes: Option[];
  levels: string[];
  classifications: string[];
}) {
  const [state, action, pending] = useActionState(decideDiscoveryAction.bind(null, discoveryId), IDLE);
  const choices = allowed.filter((a) => canManageCatalog || (a !== "register" && a !== "link"));
  const [picked, setChoice] = useState<(typeof allowed)[number] | null>(null);
  // After a decision the allowed set changes (the page revalidates): fall
  // back to the first choice still allowed, keeping the result message.
  const choice = picked && choices.includes(picked) ? picked : choices[0];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const labels = { register: "Register it", link: "Link to an application", exception: "Record an exception", ignore: "Ignore", reopen: "Reopen" } as const;
  if (!choices.length) return null;
  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-foreground">Decision</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {choices.map((a) => (
            <label key={a} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="action" value={a} checked={choice === a} onChange={() => setChoice(a)} className="size-4 accent-primary" />
              {labels[a]}
            </label>
          ))}
        </div>
      </fieldset>

      {choice === "register" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Name in the catalog" name="name" defaultValue={name} maxLength={200} required />
          <SelectField label="Type" name="appType" defaultValue="saas">
            {appTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Business owner" name="businessOwnerIdentityId" defaultValue="">
            <option value="">Not assigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Technical owner" name="technicalOwnerIdentityId" defaultValue="">
            <option value="">Not assigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Risk level" name="riskLevel" defaultValue="">
            <option value="">Not assessed</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {cap(l)}
              </option>
            ))}
          </SelectField>
          <SelectField label="Data classification" name="dataClassification" defaultValue="">
            <option value="">Not classified</option>
            {classifications.map((l) => (
              <option key={l} value={l}>
                {cap(l)}
              </option>
            ))}
          </SelectField>
          {canConnect ? (
            <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
              <input type="checkbox" name="connect" defaultChecked className="size-4 accent-primary" />
              Connect it to the connector that found it
            </label>
          ) : null}
        </div>
      ) : null}

      {choice === "link" ? (
        <SelectField label="Application" name="applicationId" defaultValue={suggestedApplicationId ?? ""} required>
          <option value="">Choose…</option>
          {applications.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </SelectField>
      ) : null}

      {choice === "exception" ? <TextField label="Exception ends on" name="exceptionUntil" type="date" required /> : null}

      <TextareaField
        label={choice === "ignore" || choice === "exception" ? "Reason" : "Note (optional)"}
        name="note"
        rows={2}
        maxLength={2000}
        required={choice === "ignore" || choice === "exception"}
        hint={choice === "ignore" ? "Ignored discoveries stay on record with this reason." : undefined}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} idle={labels[choice]} busy="Saving…" variant={choice === "ignore" ? "outline" : "default"} />
        <Result state={state} />
      </div>
    </form>
  );
}
