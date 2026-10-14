"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { ApplicationOnboardingTemplate } from "@/lib/shared/types/access-governance";
import { Button, SelectField, TextField, TextareaField } from "@/modules/ui";
import { CERTIFICATION_POLICY_LABEL, CORRELATION_IDENTITY_LABEL, REQUEST_POLICY_LABEL } from "../applications/labels";
import { parseQuestions, questionsText } from "./format";

/**
 * ACCESS-P0-34 — the onboarding template editor. Every call goes to
 * /api/v1/access/onboarding-templates (access.manage), which validates the
 * template; this page only shows the server's own result.
 */

type Template = ApplicationOnboardingTemplate;

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data?: { id: string; ref?: number | null }; message?: string }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) return { ok: false, message: json.error?.message ?? "It could not be saved" };
  return { ok: true, data: json.data };
}

/** One type per line, optionally with its maximum days: "role: 90". A type kept by name keeps its other settings. */
function parseTypes(text: string, current: Template["entitlementTypes"]) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)(?::\s*(\d+))?$/);
      const name = (m?.[1] ?? line).trim();
      const was = current.find((t) => t.name.toLowerCase() === name.toLowerCase());
      const max = m?.[2] ? Number(m[2]) : null;
      return {
        name,
        requestMode: was?.requestMode ?? "single",
        certifiable: was?.certifiable ?? true,
        defaultDurationDays: was?.defaultDurationDays != null && (max === null || was.defaultDurationDays <= max) ? was.defaultDurationDays : null,
        maxDurationDays: max,
      };
    });
}

const typesText = (types: Template["entitlementTypes"]) => types.map((t) => `${t.name}${t.maxDurationDays ? `: ${t.maxDurationDays}` : ""}`).join("\n");

export function TemplateForm({ template, connectionTypes, people }: { template?: Template; connectionTypes: { id: string; name: string }[]; people: { id: string; name: string }[] }) {
  const router = useRouter();
  const c = (template?.defaults.config ?? {}) as Record<string, string | boolean | undefined>;
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "");
        const config: Record<string, unknown> = {};
        for (const k of ["accountIdentifierField", "correlationAccountField", "correlationIdentityField", "entitlementSource", "requestPolicy", "certificationPolicy"]) if (s(k)) config[k] = s(k);
        const body = {
          name: s("name"),
          description: s("description") || null,
          connectionTypeKey: s("connectionTypeKey") || null,
          defaults: { ...config, businessOwnerIdentityId: s("businessOwnerIdentityId") || null, technicalOwnerIdentityId: s("technicalOwnerIdentityId") || null },
          entitlementTypes: parseTypes(s("entitlementTypes"), template?.entitlementTypes ?? []),
          questions: parseQuestions(s("questions")),
        };
        start(async () => {
          const r = template ? await call(`/api/v1/access/onboarding-templates/${template.id}`, "PATCH", body) : await call("/api/v1/access/onboarding-templates", "POST", body);
          if (!r.ok) {
            setError(r.message ?? "It could not be saved");
            setSaved(false);
            return;
          }
          setError(null);
          setSaved(true);
          if (!template && r.data) router.push(`/access/onboarding-templates/${r.data.ref ?? r.data.id}`);
          else router.refresh();
        });
      }}
    >
      <TextField label="Name" name="name" defaultValue={template?.name ?? ""} required maxLength={200} />
      <SelectField label="Connection type" name="connectionTypeKey" defaultValue={template?.connectionTypeKey ?? ""}>
        <option value="">Any application</option>
        {connectionTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Request policy" name="requestPolicy" defaultValue={String(c.requestPolicy ?? "")}>
        <option value="">Not set</option>
        {Object.entries(REQUEST_POLICY_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
      <SelectField label="Certification" name="certificationPolicy" defaultValue={String(c.certificationPolicy ?? "")}>
        <option value="">Not set</option>
        {Object.entries(CERTIFICATION_POLICY_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
      <SelectField label="Business owner" name="businessOwnerIdentityId" defaultValue={template?.defaults.businessOwnerIdentityId ?? ""}>
        <option value="">Not set</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Technical owner" name="technicalOwnerIdentityId" defaultValue={template?.defaults.technicalOwnerIdentityId ?? ""}>
        <option value="">Not set</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <TextareaField label="Entitlement types" name="entitlementTypes" defaultValue={typesText(template?.entitlementTypes ?? [])} rows={3} hint='One per line; "role: 90" caps requests at 90 days.' />
      <TextareaField
        label="Questionnaire"
        name="questions"
        defaultValue={questionsText(template?.questions ?? [])}
        rows={3}
        hint="One per line. End with * if required; add (yes/no) or [A | B] for a choice."
      />
      <details className="md:col-span-2">
        <summary className="cursor-pointer text-sm text-muted-foreground">More settings</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField label="Account identifier field" name="accountIdentifierField" defaultValue={String(c.accountIdentifierField ?? "")} maxLength={100} />
          <SelectField label="Entitlements from" name="entitlementSource" defaultValue={String(c.entitlementSource ?? "")}>
            <option value="">Not set</option>
            <option value="connector">The connector</option>
            <option value="manual">Manual entry</option>
          </SelectField>
          <TextField label="Correlate on account field" name="correlationAccountField" defaultValue={String(c.correlationAccountField ?? "")} maxLength={100} />
          <SelectField label="…matching the identity's" name="correlationIdentityField" defaultValue={String(c.correlationIdentityField ?? "")}>
            <option value="">Not set</option>
            {Object.entries(CORRELATION_IDENTITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </SelectField>
          <TextareaField label="Description" name="description" defaultValue={template?.description ?? ""} rows={2} maxLength={2000} className="md:col-span-2" />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : template ? "Save template" : "Add template"}
        </Button>
        <p role="status" className="text-xs">
          {error ? <span className="text-destructive">{error}</span> : saved ? <span className="text-success">Saved.</span> : null}
        </p>
      </div>
    </form>
  );
}

export function RetireTemplate({ templateId }: { templateId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await call(`/api/v1/access/onboarding-templates/${templateId}/retire`, "POST");
            if (!r.ok) setError(r.message ?? "It could not be retired");
            else router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Retire template
      </Button>
      <p role="status" className="text-xs text-destructive">
        {error}
      </p>
    </div>
  );
}
