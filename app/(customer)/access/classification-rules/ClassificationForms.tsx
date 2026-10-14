"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, SelectField, TextField, TextareaField } from "@/modules/ui";

/**
 * ACCESS-P0-33 — the classification rule editor and its actions. Every call
 * goes to /api/v1/access/classification-rules (access.manage), which
 * validates the rule; this page only shows the server's own result.
 */

export type ClassificationFormValues = { name: string; triggerType: string; applicationId: string; condition: string; field: string; value: string; mode: "report_only" | "enforce" };

const FIELDS: Record<string, { label: string; values?: string[] }> = {
  privilegeLevel: { label: "Privilege level", values: ["standard", "elevated", "admin"] },
  requestable: { label: "Requestable", values: ["true", "false"] },
  soxRelevant: { label: "SOX-relevant", values: ["true", "false"] },
  dataClassification: { label: "Data classification" },
  entitlementType: { label: "Type" },
};

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data?: unknown; message?: string }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) return { ok: false, message: json.error?.message ?? "It could not be saved" };
  return { ok: true, data: json.data };
}

function toBody(v: ClassificationFormValues) {
  const value = v.value === "true" ? true : v.value === "false" ? false : v.value === "" ? null : v.value;
  return {
    name: v.name,
    triggerType: v.triggerType,
    applicationIds: v.applicationId ? [v.applicationId] : [],
    condition: v.condition || "true",
    mode: v.mode,
    effects: [{ type: "set_attribute", params: { attribute: v.field, value } }],
  };
}

export function ClassificationRuleForm({ ruleId, initial, applications }: { ruleId?: string; initial?: ClassificationFormValues; applications: { id: string; name: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState<ClassificationFormValues>(
    initial ?? { name: "", triggerType: "entitlement.imported", applicationId: "", condition: "", field: "privilegeLevel", value: "admin", mode: "report_only" },
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof ClassificationFormValues>(k: K, value: ClassificationFormValues[K]) => setV((x) => ({ ...x, [k]: value }));
  const choices = FIELDS[v.field]?.values;

  return (
    <form
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = ruleId ? await call(`/api/v1/access/classification-rules/${ruleId}`, "PATCH", toBody(v)) : await call("/api/v1/access/classification-rules", "POST", toBody(v));
          if (!r.ok) {
            setError(r.message ?? null);
            setSaved(false);
            return;
          }
          setError(null);
          setSaved(true);
          if (!ruleId) router.push(`/access/classification-rules/${(r.data as { id: string }).id}`);
          else router.refresh();
        });
      }}
    >
      <TextField name="crName" label="Name" required maxLength={200} value={v.name} onChange={(e) => set("name", e.target.value)} />
      <SelectField name="crTrigger" label="When an entitlement is" value={v.triggerType} onChange={(e) => set("triggerType", e.target.value)}>
        <option value="entitlement.imported">Imported or created</option>
        <option value="entitlement.changed">Changed by its source</option>
      </SelectField>
      <SelectField name="crApplication" label="Application" value={v.applicationId} onChange={(e) => set("applicationId", e.target.value)}>
        <option value="">Every application</option>
        {applications.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </SelectField>
      <div className="md:col-span-2">
        <TextareaField name="crCondition" label="If (optional)" rows={2} value={v.condition} onChange={(e) => set("condition", e.target.value)} hint='For example entitlement.name matches "-admin$"' />
      </div>
      <SelectField
        name="crField"
        label="Set"
        value={v.field}
        onChange={(e) => {
          const field = e.target.value;
          setV((x) => ({ ...x, field, value: FIELDS[field]?.values?.[0] ?? "" }));
        }}
      >
        {Object.entries(FIELDS).map(([key, f]) => (
          <option key={key} value={key}>
            {f.label}
          </option>
        ))}
      </SelectField>
      {choices ? (
        <SelectField name="crValue" label="To" value={v.value} onChange={(e) => set("value", e.target.value)}>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c === "true" ? "Yes" : c === "false" ? "No" : c}
            </option>
          ))}
        </SelectField>
      ) : (
        <TextField name="crValue" label="To" value={v.value} onChange={(e) => set("value", e.target.value)} hint="Leave empty to clear it" />
      )}
      <SelectField name="crMode" label="Mode" value={v.mode} onChange={(e) => set("mode", e.target.value as ClassificationFormValues["mode"])} hint="Report only records what the rule would do">
        <option value="report_only">Report only</option>
        <option value="enforce">Enforce</option>
      </SelectField>
      <div className="flex items-end gap-3 md:col-span-2">
        <Button type="submit" disabled={pending || !v.name.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {ruleId ? "Save changes" : "Create rule"}
        </Button>
        <p role="status" className="text-xs">
          {error ? <span className="text-destructive">{error}</span> : saved && ruleId ? <span className="text-success">Saved. Simulate it again before publishing.</span> : null}
        </p>
      </div>
    </form>
  );
}

type Simulation = {
  evaluated: number;
  truncated: boolean;
  matched: number;
  wouldChange: number;
  changes: { entitlementId: string; name: string; field: string; before: unknown; after: unknown }[];
  skipped: { entitlementId: string; name: string; field: string; reason: string }[];
  errors: string[];
};
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "(empty)" : String(v));

export function ClassificationNextStep({ ruleId, step }: { ruleId: string; step: "simulate" | "request" | "approve" | "waiting" | "none" }) {
  const router = useRouter();
  const [sim, setSim] = useState<Simulation | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (url: string, body?: unknown) =>
    start(async () => {
      const r = await call(url, "POST", body);
      if (!r.ok) return setError(r.message ?? null);
      setError(null);
      if (url.endsWith("/simulate")) setSim(r.data as Simulation);
      if (body && (body as { action?: string }).action === "approve") setApplied((r.data as { appliedTo?: number }).appliedTo ?? 0);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {step === "simulate" || step === "request" || step === "waiting" ? (
          <Button variant={step === "simulate" ? "default" : "outline"} disabled={pending} onClick={() => run(`/api/v1/access/classification-rules/${ruleId}/simulate`)}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Simulate
          </Button>
        ) : null}
        {step === "request" ? (
          <Button disabled={pending} onClick={() => run(`/api/v1/access/classification-rules/${ruleId}/publish`, { action: "request" })}>
            Ask to publish
          </Button>
        ) : null}
        {step === "approve" ? (
          <Button disabled={pending} onClick={() => run(`/api/v1/access/classification-rules/${ruleId}/publish`, { action: "approve" })}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Approve and publish
          </Button>
        ) : null}
        {step === "waiting" ? <span className="text-sm text-muted-foreground">Waiting for another administrator to approve.</span> : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {applied !== null ? (
        <p role="status" className="text-sm text-success">
          Published. {applied} existing {applied === 1 ? "entitlement was" : "entitlements were"} classified.
        </p>
      ) : null}
      {sim ? (
        <div role="status" className="space-y-2 rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-foreground">
            Would change {sim.wouldChange} of {sim.evaluated} entitlements{sim.truncated ? " (the first ones in scope)" : ""}; {sim.matched} matched.
          </p>
          {sim.changes.length ? (
            <ul className="space-y-1 text-muted-foreground">
              {sim.changes.map((c, i) => (
                <li key={`${c.entitlementId}-${c.field}-${i}`}>
                  <span className="text-foreground">{c.name}</span>: {c.field} {show(c.before)} → {show(c.after)}
                </li>
              ))}
            </ul>
          ) : null}
          {sim.skipped.length ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">{sim.skipped.length} left as they are</summary>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {sim.skipped.map((s, i) => (
                  <li key={`${s.entitlementId}-${s.field}-${i}`}>
                    {s.name}: {s.field}, {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {sim.errors.length ? <p className="text-xs text-destructive">{sim.errors.join("; ")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function RetireClassificationRule({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await call(`/api/v1/access/classification-rules/${ruleId}/retire`, "POST");
            if (!r.ok) return setError(r.message ?? null);
            router.refresh();
          })
        }
      >
        Retire rule
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
