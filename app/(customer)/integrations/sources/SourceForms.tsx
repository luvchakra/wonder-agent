"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import {
  createIdentitySourceAction,
  resolveCorrelationAction,
  runIntegrationImportAction,
  updateIdentitySourceAction,
  type SourceFormState,
} from "@/app/actions/identitySources";
import { Button, SelectField, TextField, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { IDENTITY_SOURCE_TARGETS, SOURCE_IDENTITY_TYPES, type AttributeMapping, type CorrelationRule, type IdentitySource } from "@/lib/shared/types/integrations";
import { SOURCED_IDENTITY_FIELDS } from "@/lib/shared/types/agent-identity";
import { LEAVER_LABEL, TARGET_LABEL, TEMPLATE_LABEL } from "./labels";

const IDLE: SourceFormState = { status: "idle" };

function Result({ state }: { state: SourceFormState }) {
  return (
    <p role="status" className="min-h-5 text-xs">
      {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
      {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
    </p>
  );
}

const TYPE_LABEL: Record<(typeof SOURCE_IDENTITY_TYPES)[number], string> = {
  HUMAN: "People (employees)",
  EXTERNAL: "External people",
  SERVICE_ACCOUNT: "Service accounts",
  APPLICATION: "Application accounts",
  WORKLOAD: "Workloads",
  API: "API clients",
  MACHINE: "Machines",
};

/** Suggested column mappings per template; every row stays editable. */
const TEMPLATE_MAPPINGS: Record<string, AttributeMapping[]> = {
  csv: [
    { source: "employee_id", target: "externalId" },
    { source: "full_name", target: "displayName" },
    { source: "email", target: "email" },
    { source: "department", target: "department" },
    { source: "title", target: "title" },
    { source: "manager_id", target: "managerExternalId" },
    { source: "status", target: "status" },
    { source: "start_date", target: "startDate" },
    { source: "end_date", target: "endDate" },
  ],
  hr_api: [
    { source: "workerId", target: "externalId" },
    { source: "name.formatted", target: "displayName" },
    { source: "workEmail", target: "email" },
    { source: "organization.name", target: "department" },
    { source: "jobTitle", target: "title" },
    { source: "managerWorkerId", target: "managerExternalId" },
    { source: "workerStatus", target: "status" },
    { source: "hireDate", target: "startDate" },
  ],
  scim: [
    { source: "id", target: "externalId" },
    { source: "displayName", target: "displayName" },
    { source: "emails.0.value", target: "email" },
    { source: "userName", target: "username" },
    { source: "title", target: "title" },
  ],
  rest: [
    { source: "id", target: "externalId" },
    { source: "name", target: "displayName" },
    { source: "email", target: "email" },
  ],
  integration: [
    { source: "externalId", target: "externalId" },
    { source: "normalized.displayName", target: "displayName" },
    { source: "normalized.email", target: "email" },
  ],
};

function MappingEditor({ initial }: { initial: AttributeMapping[] }) {
  const [rows, setRows] = useState<AttributeMapping[]>(initial.length ? initial : [{ source: "", target: "externalId" }]);
  const update = (i: number, patch: Partial<AttributeMapping>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-medium text-foreground">Attribute mappings</legend>
      <p className="text-xs text-muted-foreground">Source column (or a dotted path in a JSON record) → identity field. Map the source&apos;s unique id and a display name at least.</p>
      <input type="hidden" name="attributeMappings" value={JSON.stringify(rows.filter((r) => r.source.trim()))} />
      <ul className="mt-2 space-y-2">
        {rows.map((row, i) => (
          <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <input
              aria-label={`Source column ${i + 1}`}
              className={fieldInputClass}
              value={row.source}
              onChange={(e) => update(i, { source: e.target.value })}
              placeholder="Column name"
            />
            <select aria-label={`Identity field ${i + 1}`} className={fieldInputClass} value={row.target} onChange={(e) => update(i, { target: e.target.value as AttributeMapping["target"] })}>
              {IDENTITY_SOURCE_TARGETS.map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABEL[t]}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" size="sm" aria-label={`Remove mapping ${i + 1}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setRows((r) => [...r, { source: "", target: "department" }])}>
        <Plus className="size-4" aria-hidden="true" /> Add mapping
      </Button>
    </fieldset>
  );
}

function CorrelationEditor({ initial }: { initial: CorrelationRule[] }) {
  const has = (k: string) => initial.some((r) => r.kind === k);
  const composite = initial.find((r) => r.kind === "composite");
  const [email, setEmail] = useState(initial.length ? has("email") : true);
  const [username, setUsername] = useState(has("username"));
  const [nameDate, setNameDate] = useState(Boolean(composite));
  const rules: CorrelationRule[] = [
    ...(email ? [{ kind: "email" as const }] : []),
    ...(username ? [{ kind: "username" as const }] : []),
    ...(nameDate ? [{ kind: "composite" as const, fields: composite?.fields ?? ["displayName", "startDate"] }] : []),
  ];
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-medium text-foreground">Correlation rules</legend>
      <p className="text-xs text-muted-foreground">
        How a new record finds an existing identity, tried in this order. One match links it; several go to Pending matches for a person
        to decide; none creates a new identity.
      </p>
      <input type="hidden" name="correlationRules" value={JSON.stringify(rules)} />
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="size-4 accent-primary" /> Email
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={username} onChange={(e) => setUsername(e.target.checked)} className="size-4 accent-primary" /> Username
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={nameDate} onChange={(e) => setNameDate(e.target.checked)} className="size-4 accent-primary" /> Name and start date
        </label>
      </div>
    </fieldset>
  );
}

export function SourceForm({ source, integrations }: { source?: IdentitySource; integrations: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(source ? updateIdentitySourceAction.bind(null, source.id) : createIdentitySourceAction, IDLE);
  const [template, setTemplate] = useState<string>(source?.template ?? "csv");
  const [authoritative, setAuthoritative] = useState(source?.authoritative ?? false);
  const [mappingsKey, setMappingsKey] = useState(0);
  const initialMappings = source?.attributeMappings ?? TEMPLATE_MAPPINGS[template] ?? [];
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField label="Name" name="name" required maxLength={120} defaultValue={source?.name} placeholder="Workday HR" />
      {source ? (
        <div>
          <span className={fieldLabelClass}>Source type</span>
          <p className="py-1.5 text-sm text-foreground">{TEMPLATE_LABEL[source.template]}</p>
        </div>
      ) : (
        <SelectField
          label="Source type"
          name="template"
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
            setMappingsKey((k) => k + 1);
          }}
        >
          {Object.entries(TEMPLATE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
      )}
      {!source && template === "integration" ? (
        <div className="sm:col-span-2">
          <SelectField label="Integration" name="integrationId" required defaultValue="" hint="Its imported identity records feed this source">
            <option value="">Choose an integration</option>
            {integrations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}
      <SelectField label="Identities it provides" name="identityType" defaultValue={source?.identityType ?? "HUMAN"}>
        {SOURCE_IDENTITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </SelectField>
      <TextField label="Precedence" name="priority" type="number" min={1} max={1000} defaultValue={source?.priority ?? 100} hint="1 is highest. Where two sources own a field, the higher one wins." />

      <fieldset className="sm:col-span-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input type="checkbox" name="authoritative" checked={authoritative} onChange={(e) => setAuthoritative(e.target.checked)} className="size-4 accent-primary" />
          Authoritative source
        </label>
        <p className="text-xs text-muted-foreground">
          An authoritative source is the system of record for the fields ticked below: its values replace others. Any other mapped field only
          fills a blank.
        </p>
        {authoritative ? (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-foreground sm:grid-cols-3">
            {SOURCED_IDENTITY_FIELDS.filter((f) => f !== "managerIdentityId").map((f) => (
              <label key={f} className="flex items-center gap-2">
                <input type="checkbox" name="authoritativeFields" value={f} defaultChecked={source?.authoritativeFields.includes(f)} className="size-4 accent-primary" />
                {TARGET_LABEL[f as keyof typeof TARGET_LABEL] ?? f}
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input type="checkbox" name="authoritativeFields" value="managerIdentityId" defaultChecked={source?.authoritativeFields.includes("managerIdentityId")} className="size-4 accent-primary" />
              Manager
            </label>
          </div>
        ) : null}
      </fieldset>

      <MappingEditor key={mappingsKey} initial={initialMappings} />
      <CorrelationEditor initial={source?.correlationRules ?? [{ kind: "email" }]} />

      <SelectField label="When a record disappears" name="leaverStrategy" defaultValue={source?.leaverStrategy ?? "disable"}>
        {Object.entries(LEAVER_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Leaver safety limit (%)"
        name="leaverThresholdPercent"
        type="number"
        min={1}
        max={100}
        defaultValue={source?.leaverThresholdPercent ?? 20}
        hint="If more linked identities than this are missing, the run applies no leavers and asks for review"
      />
      {source ? (
        <SelectField label="Status" name="status" defaultValue={source.status}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </SelectField>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : source ? "Save source" : "Create source"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

/**
 * CSV import. Reads the file in the browser and posts it to the runs API
 * (a server action would cap it at 1 MB); the page then follows the run.
 */
export function CsvImportForm({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a CSV file.");
    if (file.size > 4_000_000) return setError("The file is larger than 4 MB. Split it, and import the parts with Partial.");
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/integrations/identity-sources/${sourceId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "upload", mode: form.get("mode"), dryRun: form.get("dryRun") === "on", csvText: await file.text() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? `The import was not started (${res.status}).`);
        return;
      }
      router.push(`/integrations/sources/${sourceId}/runs/${body.data.id}`);
    } catch {
      setError("The import could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
      <div>
        <label htmlFor="file" className={fieldLabelClass}>
          CSV file
        </label>
        <input id="file" name="file" type="file" accept=".csv,text/csv" className={`${fieldInputClass} py-1 file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-0.5 file:text-sm`} />
      </div>
      <SelectField label="Contents" name="mode" defaultValue="full">
        <option value="full">Everyone (full)</option>
        <option value="partial">Some records (partial)</option>
      </SelectField>
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
        {busy ? "Uploading…" : "Import"}
      </Button>
      <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-3">
        <input type="checkbox" name="dryRun" className="size-4 accent-primary" />
        Preview only: show what would change, and change nothing
      </label>
      <p role="status" className="min-h-5 text-xs text-destructive sm:col-span-3">
        {error}
      </p>
    </form>
  );
}

export function IntegrationImportForm({ sourceId }: { sourceId: string }) {
  const [state, action, pending] = useActionState(runIntegrationImportAction.bind(null, sourceId), IDLE);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_auto] sm:items-end">
      <SelectField label="Contents" name="mode" defaultValue="full">
        <option value="full">Everyone (full)</option>
        <option value="partial">Some records (partial)</option>
      </SelectField>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? "Starting…" : "Reconcile from integration"}
      </Button>
      <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
        <input type="checkbox" name="dryRun" className="size-4 accent-primary" />
        Preview only: show what would change, and change nothing
      </label>
      <div className="sm:col-span-2">
        <Result state={state} />
      </div>
    </form>
  );
}

/** Refreshes the page every 2 s while a run is queued or running (for up to 2 minutes). */
export function RunAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 2000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 120_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [active, router]);
  return null;
}

export function CorrelationDecision({
  pendingId,
  candidates,
  canResolve,
}: {
  pendingId: string;
  candidates: { id: string; label: string }[];
  canResolve: boolean;
}) {
  const [linkState, linkAction, linking] = useActionState(
    async (_prev: SourceFormState, formData: FormData) =>
      resolveCorrelationAction(pendingId, { action: "link", identityId: String(formData.get("identityId") ?? "") }),
    IDLE,
  );
  const [createState, createAction, creating] = useActionState(resolveCorrelationAction.bind(null, pendingId, { action: "create" }), IDLE);
  const [dismissState, dismissAction, dismissing] = useActionState(resolveCorrelationAction.bind(null, pendingId, { action: "dismiss" }), IDLE);
  const state = [linkState, createState, dismissState].find((s) => s.status !== "idle") ?? IDLE;
  if (!canResolve) return <p className="text-xs text-muted-foreground">An identity administrator decides this match.</p>;
  const busy = linking || creating || dismissing;
  return (
    <div className="space-y-2">
      <form action={linkAction} className="flex flex-wrap items-center gap-2">
        <select name="identityId" aria-label="Candidate identity" className={`${fieldInputClass} sm:max-w-xs`} defaultValue={candidates[0]?.id}>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={busy}>
          {linking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Link
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <form action={createAction}>
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {creating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Create new identity
          </Button>
        </form>
        <form action={dismissAction}>
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {dismissing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Dismiss
          </Button>
        </form>
      </div>
      <Result state={state} />
    </div>
  );
}
