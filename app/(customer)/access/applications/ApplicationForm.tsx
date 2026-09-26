"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { registerApplicationAction, updateApplicationAction, type ApplicationFormState } from "@/app/actions/applications";
import { Button, SelectField, TextField, TextareaField } from "@/modules/ui";
import {
  APPLICATION_ENVIRONMENTS,
  APPLICATION_TYPES,
  CATALOG_LEVELS,
  DATA_CLASSIFICATION_LEVELS,
  type Application,
} from "@/lib/shared/types/access-governance";
import { APP_TYPE_LABEL } from "./labels";

const IDLE: ApplicationFormState = { status: "idle" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type OwnerOption = { id: string; displayName: string; email: string | null };

function OwnerSelect({ label, name, people, defaultValue }: { label: string; name: string; people: OwnerOption[]; defaultValue?: string | null }) {
  return (
    <SelectField label={label} name={name} defaultValue={defaultValue ?? ""}>
      <option value="">Not assigned</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.displayName}
          {p.email && p.email !== p.displayName ? ` (${p.email})` : ""}
        </option>
      ))}
    </SelectField>
  );
}

function LevelSelect({ label, name, values, defaultValue }: { label: string; name: string; values: readonly string[]; defaultValue?: string | null }) {
  return (
    <SelectField label={label} name={name} defaultValue={defaultValue ?? ""}>
      <option value="">Not assessed</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {cap(v)}
        </option>
      ))}
    </SelectField>
  );
}

/** Registers an application, or edits one when `application` is given. */
export function ApplicationForm({ application, people }: { application?: Application; people: OwnerOption[] }) {
  const [state, action, pending] = useActionState(application ? updateApplicationAction.bind(null, application.id) : registerApplicationAction, IDLE);
  const a = application;
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField label="Name" name="name" required maxLength={200} defaultValue={a?.name} placeholder="Snowflake" />
      <TextField label="Display name (optional)" name="displayName" maxLength={200} defaultValue={a?.displayName ?? ""} placeholder="Snowflake data warehouse" />
      <SelectField label="Type" name="appType" defaultValue={a?.appType ?? "saas"}>
        {APPLICATION_TYPES.map((t) => (
          <option key={t} value={t}>
            {APP_TYPE_LABEL[t]}
          </option>
        ))}
      </SelectField>
      <TextField label="Vendor" name="vendor" maxLength={200} defaultValue={a?.vendor ?? ""} />
      <TextField label="Category" name="category" maxLength={100} defaultValue={a?.category ?? ""} placeholder="erp, crm, data_warehouse…" />
      <TextField label="Address" name="url" type="url" maxLength={500} defaultValue={a?.url ?? ""} placeholder="https://" hint="https only" />
      <div className="sm:col-span-2">
        <TextareaField label="Description" name="description" maxLength={2000} rows={2} defaultValue={a?.description ?? ""} />
      </div>
      <OwnerSelect label="Business owner" name="businessOwnerIdentityId" people={people} defaultValue={a?.businessOwnerIdentityId} />
      <OwnerSelect label="Technical owner" name="technicalOwnerIdentityId" people={people} defaultValue={a?.technicalOwnerIdentityId} />
      <SelectField label="Environment" name="environment" defaultValue={a?.environment ?? "production"}>
        {APPLICATION_ENVIRONMENTS.map((e) => (
          <option key={e} value={e}>
            {cap(e)}
          </option>
        ))}
      </SelectField>
      <LevelSelect label="Data classification" name="dataClassification" values={DATA_CLASSIFICATION_LEVELS} defaultValue={a?.dataClassification} />
      <LevelSelect label="Risk level" name="riskLevel" values={CATALOG_LEVELS} defaultValue={a?.riskLevel} />
      <LevelSelect label="Business criticality" name="criticality" values={CATALOG_LEVELS} defaultValue={a?.criticality} />
      <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
        <input type="hidden" name="isExternalPresent" value="1" />
        <input type="checkbox" name="isExternal" defaultChecked={a?.isExternal} className="size-4 accent-primary" />
        External-facing (email, messaging, public API)
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : a ? "Save changes" : "Register application"}
        </Button>
        <p role="status" className="min-h-5 text-xs">
          {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
          {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
        </p>
      </div>
    </form>
  );
}
