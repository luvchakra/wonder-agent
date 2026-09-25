"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import {
  createDataSourceAction,
  linkEntitlementDataSourceAction,
  reclassifyDataSourceAction,
  type DataSourceFormState,
} from "@/app/actions/access";
import { Button, SelectField, TextField } from "@/modules/ui";

const KIND_LABEL: Record<string, string> = {
  database: "Database",
  warehouse: "Data warehouse",
  object_store: "Object store",
  file_share: "File share",
  saas: "SaaS object",
  api: "API",
  other: "Other",
};

function Result({ state }: { state: DataSourceFormState }) {
  return (
    <p role="status" className="min-h-5 text-xs">
      {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
      {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
    </p>
  );
}

function Submit({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? busy : idle}
    </Button>
  );
}

export function CreateDataSourceForm({ applications }: { applications: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(createDataSourceAction, { status: "idle" } as DataSourceFormState);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <TextField label="Data source name" name="name" required maxLength={200} placeholder="e.g. Snowflake CustomerDB" />
      <SelectField label="Kind" name="kind" defaultValue="database">
        {Object.entries(KIND_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <SelectField label="Application (optional)" name="applicationId" defaultValue="">
        <option value="">None</option>
        {applications.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </SelectField>
      <TextField label="Classification" name="classification" maxLength={100} placeholder="e.g. restricted, pii, financial" />
      <TextField label="Owner (optional)" name="owner" maxLength={200} />
      <div className="flex items-end gap-3">
        <Submit pending={pending} idle="Add data source" busy="Adding…" />
        <Result state={state} />
      </div>
    </form>
  );
}

export function LinkEntitlementForm({
  entitlements,
  dataSources,
}: {
  entitlements: Array<{ id: string; label: string }>;
  dataSources: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState(linkEntitlementDataSourceAction, { status: "idle" } as DataSourceFormState);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <SelectField label="Entitlement" name="entitlementId" required defaultValue="">
        <option value="" disabled>
          Choose an entitlement
        </option>
        {entitlements.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </SelectField>
      <SelectField label="Opens data source" name="dataSourceId" required defaultValue="">
        <option value="" disabled>
          Choose a data source
        </option>
        {dataSources.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>
      <div className="flex items-end gap-3">
        <Submit pending={pending} idle="Link" busy="Linking…" />
        <Result state={state} />
      </div>
    </form>
  );
}

export function ReclassifyForm({ id, name, current }: { id: string; name: string; current: string | null }) {
  const [state, action, pending] = useActionState(reclassifyDataSourceAction.bind(null, id), { status: "idle" } as DataSourceFormState);
  const inputId = `classification-${id}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label htmlFor={inputId} className="sr-only">
        Classification for {name}
      </label>
      <input
        id={inputId}
        name="classification"
        defaultValue={current ?? ""}
        maxLength={100}
        placeholder="unclassified"
        className="w-32 min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      />
      <Button type="submit" variant="ghost" size="sm" disabled={pending} aria-label={`Save classification for ${name}`}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Save"}
      </Button>
      {state.status === "error" ? <span className="text-xs text-destructive">{state.message}</span> : null}
      {state.status === "saved" ? <span className="text-xs text-success">{state.message}</span> : null}
    </form>
  );
}
