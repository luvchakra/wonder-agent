"use client";

import { useState } from "react";
import { Button, SelectField, TextField } from "@/modules/ui";
import {
  FORM_AUTH_TYPES,
  FORM_PAGINATION_TYPES,
  authPreset,
  hasSeveralRequests,
  newResource,
  paginationPreset,
  pathOf,
  resourceOf,
  withFieldPath,
  withResource,
  type FormAuthType,
  type FormPaginationType,
  type SamplePath,
} from "@/modules/ui/connectorEditor";
import { CANONICAL_FIELDS, CONNECTOR_CATEGORIES, RESOURCE_KINDS, type ConnectorDefinition, type Pagination, type ResourceKind, type ResourceSpec, type SettingField } from "@/modules/integrations/framework/types";

const SETTING_TYPES: SettingField["type"][] = ["url", "string", "number", "boolean", "select"];

/**
 * EXPERIENCE-P0-30 — a form over the definition: basics, settings,
 * authentication and one resource at a time. Every change rewrites the
 * definition the JSON view shows, so the two never disagree; what the form
 * does not cover (other drivers, templates, transforms, writes, receiving)
 * is kept untouched and edited in JSON.
 */
export function GuidedForm({
  def,
  onChange,
  kind,
  onKind,
  samples,
}: {
  def: ConnectorDefinition;
  onChange: (next: ConnectorDefinition) => void;
  kind: ResourceKind | null;
  onKind: (kind: ResourceKind) => void;
  samples: SamplePath[];
}) {
  const [adding, setAdding] = useState<ResourceKind | "">("");
  const set = (patch: Partial<ConnectorDefinition>) => onChange({ ...def, ...patch });
  const kinds = RESOURCE_KINDS.filter((k) => def.resources[k]);
  const resource = kind ? resourceOf(def, kind) : null;
  const setResource = (next: ResourceSpec) => kind && onChange(withResource(def, kind, next));
  const authType = (FORM_AUTH_TYPES as readonly string[]).includes(def.auth.type) ? (def.auth.type as FormAuthType) : null;
  const setting = (i: number, patch: Partial<SettingField>) => set({ settings: def.settings.map((s, n) => (n === i ? { ...s, ...patch } : s)) });

  return (
    <div className="space-y-4">
      {samples.length ? (
        <datalist id="sample-paths">
          {samples.map((s) => (
            <option key={s.path} value={s.path}>
              {s.example}
            </option>
          ))}
        </datalist>
      ) : null}

      <Section title="Basics" open>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" name="g-name" value={def.name} onChange={(e) => set({ name: e.target.value })} />
          <TextField label="Key" name="g-key" value={def.key} onChange={(e) => set({ key: e.target.value })} hint="Lowercase with dashes" />
          <TextField label="Version" name="g-version" value={def.version} onChange={(e) => set({ version: e.target.value })} />
          <SelectField label="Category" name="g-category" value={def.category} onChange={(e) => set({ category: e.target.value as ConnectorDefinition["category"] })}>
            {CONNECTOR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="Description" name="g-description" value={def.description} onChange={(e) => set({ description: e.target.value })} />
      </Section>

      {def.driver !== "http" ? (
        <p className="text-sm text-muted-foreground">The form covers web APIs; edit this {def.driver} definition&apos;s connection and resources in JSON.</p>
      ) : (
        <>
          <Section title={`Settings (${def.settings.length})`}>
            {def.settings.map((s, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
                <TextField label="Setting key" name={`g-setting-key-${i}`} value={s.key} onChange={(e) => setting(i, { key: e.target.value })} />
                <TextField label="Setting label" name={`g-setting-label-${i}`} value={s.label} onChange={(e) => setting(i, { label: e.target.value })} />
                <SelectField label="Setting type" name={`g-setting-type-${i}`} value={s.type} onChange={(e) => setting(i, { type: e.target.value as SettingField["type"] })}>
                  {SETTING_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </SelectField>
                <Button type="button" variant="ghost" size="sm" onClick={() => set({ settings: def.settings.filter((_, n) => n !== i) })}>
                  Remove
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set({ settings: [...def.settings, { key: "", label: "", type: "string" }] })}>
              Add a setting
            </Button>
          </Section>

          <Section title="Authentication">
            <SelectField
              label="Type"
              name="g-auth-type"
              value={authType ?? ""}
              onChange={(e) => e.target.value && set({ auth: authPreset(e.target.value as FormAuthType) })}
              hint={authType ? "Secrets are entered per connection and referenced as {secret.<key>}" : `${def.auth.type}: edit in JSON`}
            >
              {authType ? null : <option value="">{def.auth.type}</option>}
              {FORM_AUTH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </SelectField>
            {def.auth.type === "header" || def.auth.type === "query" ? (
              <TextField label="Parameter name" name="g-auth-name" value={def.auth.name} onChange={(e) => set({ auth: { ...def.auth, name: e.target.value } as typeof def.auth })} />
            ) : null}
            {def.auth.type === "oauth2_client_credentials" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Token address" name="g-auth-token-url" value={def.auth.tokenUrl} onChange={(e) => set({ auth: { ...def.auth, tokenUrl: e.target.value } as typeof def.auth })} />
                <TextField label="Scope" name="g-auth-scope" value={def.auth.scope ?? ""} onChange={(e) => set({ auth: { ...def.auth, scope: e.target.value || undefined } as typeof def.auth })} />
              </div>
            ) : null}
            <TextField
              label="Connection test path"
              name="g-test-path"
              value={def.test?.request?.path ?? ""}
              onChange={(e) => set({ test: e.target.value ? { ...def.test, request: { ...def.test?.request, path: e.target.value } } : undefined })}
              hint="A cheap authenticated read, such as /api/me"
            />
          </Section>

          <Section title="Resources" open>
            <div className="flex flex-wrap items-end gap-2">
              {kinds.length ? (
                <SelectField label="Edit" name="g-kind" value={kind ?? ""} onChange={(e) => onKind(e.target.value as ResourceKind)}>
                  {kinds.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </SelectField>
              ) : null}
              <SelectField label="Add" name="g-add-kind" value={adding} onChange={(e) => setAdding(e.target.value as ResourceKind)}>
                <option value="">Choose…</option>
                {RESOURCE_KINDS.filter((k) => !def.resources[k]).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </SelectField>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!adding}
                onClick={() => {
                  if (!adding) return;
                  onChange({ ...def, resources: { ...def.resources, [adding]: newResource(CANONICAL_FIELDS[adding].required) } });
                  onKind(adding);
                  setAdding("");
                }}
              >
                Add
              </Button>
            </div>
            {kind && resource ? <ResourceForm key={kind} kind={kind} resource={resource} onChange={setResource} several={hasSeveralRequests(def, kind)} hasSamples={samples.length > 0} /> : null}
          </Section>
        </>
      )}
    </div>
  );
}

function ResourceForm({ kind, resource, onChange, several, hasSamples }: { kind: ResourceKind; resource: ResourceSpec; onChange: (r: ResourceSpec) => void; several: boolean; hasSamples: boolean }) {
  const pagination: Pagination = resource.pagination ?? { type: "none" };
  const pageType = (FORM_PAGINATION_TYPES as readonly string[]).includes(pagination.type) ? (pagination.type as FormPaginationType) : null;
  const [extra, setExtra] = useState<string[]>([]);
  const canonical = CANONICAL_FIELDS[kind];
  // Required fields, the ones mapped, and any just added; the rest wait behind "Map another field".
  const fieldNames = [...canonical.required, ...canonical.optional].filter((f) => canonical.required.includes(f) || f in resource.fields || extra.includes(f));
  const unmapped = canonical.optional.filter((f) => !fieldNames.includes(f));
  const records = Array.isArray(resource.records) ? null : (resource.records ?? "");

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {several ? <p className="text-xs text-muted-foreground">This kind lists several requests; the form edits the first.</p> : null}
      <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
        <SelectField
          label="Method"
          name="g-method"
          value={resource.request?.method ?? "GET"}
          onChange={(e) => onChange({ ...resource, request: { ...resource.request!, path: resource.request?.path ?? "/", method: e.target.value === "GET" ? undefined : (e.target.value as "POST") } })}
        >
          <option>GET</option>
          <option>POST</option>
        </SelectField>
        <TextField label="Path" name="g-path" value={resource.request?.path ?? ""} onChange={(e) => onChange({ ...resource, request: { ...resource.request, path: e.target.value } })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {records !== null ? (
          <TextField label="Records at" name="g-records" value={records} onChange={(e) => onChange({ ...resource, records: e.target.value })} hint="Path to the list in the response; empty when the response is the list" />
        ) : null}
        <SelectField
          label="Pagination"
          name="g-pagination"
          value={pageType ?? ""}
          onChange={(e) => e.target.value && onChange({ ...resource, pagination: paginationPreset(e.target.value as FormPaginationType) })}
          hint={pageType ? undefined : `${pagination.type}: edit in JSON`}
        >
          {pageType ? null : <option value="">{pagination.type}</option>}
          {FORM_PAGINATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Fields</p>
        <p className="text-xs text-muted-foreground">{hasSamples ? "Pick a path from the sample, or type one." : "Try it below to pick paths from a sample response."}</p>
        {fieldNames.map((f) => {
          const path = pathOf(resource.fields[f]);
          const required = canonical.required.includes(f);
          return path === null ? (
            <p key={f} className="text-xs text-muted-foreground">
              <code>{f}</code>: built from several values; edit in JSON
            </p>
          ) : (
            <TextField
              key={f}
              label={required ? `${f} (required)` : f}
              name={`g-field-${f}`}
              value={path}
              list={hasSamples ? "sample-paths" : undefined}
              autoComplete="off"
              className="font-mono text-xs"
              onChange={(e) => onChange({ ...resource, fields: withFieldPath(resource.fields, f, e.target.value) })}
            />
          );
        })}
        {unmapped.length ? (
          <SelectField label="Map another field" name="g-more" value="" onChange={(e) => e.target.value && setExtra([...extra, e.target.value])}>
            <option value="">Choose…</option>
            {unmapped.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </SelectField>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer text-sm font-medium text-foreground">{title}</summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}
