"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, SelectField, TextField, TextareaField } from "@/modules/ui";

/**
 * IDENTITY-P0-21 — the attribute rule editor and its actions. Every call
 * goes to /api/v1/identities/rules, which checks identity.manage and
 * validates the rule; this page only shows the server's own result.
 */

export type RuleFormValues = {
  name: string;
  triggerType: string;
  triggerAttribute: string;
  condition: string;
  attribute: string;
  valueKind: "fixed" | "template";
  value: string;
  mode: "report_only" | "enforce";
};

const TRIGGERS = [
  { value: "identity.created", label: "Created in WonderID" },
  { value: "identity.imported", label: "Imported from a source" },
  { value: "identity.attribute_changed", label: "An attribute changed" },
];

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data?: unknown; message?: string }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) return { ok: false, message: json.error?.message ?? "It could not be saved" };
  return { ok: true, data: json.data };
}

function toBody(v: RuleFormValues) {
  return {
    name: v.name,
    triggerType: v.triggerType,
    triggerAttribute: v.triggerType === "identity.attribute_changed" ? v.triggerAttribute || null : null,
    condition: v.condition || "true",
    mode: v.mode,
    effects: [{ type: "set_attribute", params: { attribute: v.attribute, value: v.valueKind === "template" ? { template: v.value } : v.value === "" ? null : v.value } }],
  };
}

export function RuleForm({ ruleId, initial, settable }: { ruleId?: string; initial?: RuleFormValues; settable: string[] }) {
  const router = useRouter();
  const [v, setV] = useState<RuleFormValues>(
    initial ?? { name: "", triggerType: "identity.created", triggerAttribute: "", condition: "", attribute: settable[0] ?? "", valueKind: "template", value: "", mode: "report_only" },
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof RuleFormValues>(k: K, value: RuleFormValues[K]) => setV((x) => ({ ...x, [k]: value }));

  return (
    <form
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = ruleId ? await call(`/api/v1/identities/rules/${ruleId}`, "PATCH", toBody(v)) : await call("/api/v1/identities/rules", "POST", toBody(v));
          if (!r.ok) {
            setError(r.message ?? null);
            setSaved(false);
            return;
          }
          setError(null);
          setSaved(true);
          if (!ruleId) router.push(`/identities/rules/${(r.data as { id: string }).id}`);
          else router.refresh();
        });
      }}
    >
      <TextField name="ruleName" label="Name" required maxLength={200} value={v.name} onChange={(e) => set("name", e.target.value)} />
      <SelectField name="ruleTrigger" label="When" value={v.triggerType} onChange={(e) => set("triggerType", e.target.value)}>
        {TRIGGERS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </SelectField>
      {v.triggerType === "identity.attribute_changed" ? (
        <TextField
          name="ruleTriggerAttribute"
          label="Only when this changes (optional)"
          value={v.triggerAttribute}
          onChange={(e) => set("triggerAttribute", e.target.value)}
          hint="For example department"
        />
      ) : null}
      <div className="md:col-span-2">
        <TextareaField
          name="ruleCondition"
          label="If (optional)"
          rows={2}
          value={v.condition}
          onChange={(e) => set("condition", e.target.value)}
          hint='For example identity.department = "Finance" and not exists identity.region'
        />
      </div>
      <SelectField name="ruleAttribute" label="Set" value={v.attribute} onChange={(e) => set("attribute", e.target.value)}>
        {settable.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </SelectField>
      <SelectField name="ruleValueKind" label="To" value={v.valueKind} onChange={(e) => set("valueKind", e.target.value as RuleFormValues["valueKind"])}>
        <option value="template">A value built from other fields</option>
        <option value="fixed">A fixed value</option>
      </SelectField>
      <div className="md:col-span-2">
        <TextField
          name="ruleValue"
          label="Value"
          value={v.value}
          onChange={(e) => set("value", e.target.value)}
          hint={v.valueKind === "template" ? "For example {identity.firstName} {identity.lastName}" : "Leave empty to clear it"}
        />
      </div>
      <SelectField name="ruleMode" label="Mode" value={v.mode} onChange={(e) => set("mode", e.target.value as RuleFormValues["mode"])} hint="Report only records what the rule would do">
        <option value="report_only">Report only</option>
        <option value="enforce">Enforce</option>
      </SelectField>
      <div className="flex items-end gap-3 md:col-span-2">
        <Button type="submit" disabled={pending || !v.name.trim() || !v.attribute}>
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
  share: number;
  changes: { identityId: string; displayName: string; attribute: string; before: unknown; after: unknown }[];
  skipped: { identityId: string; displayName: string; attribute: string; reason: string }[];
  errors: string[];
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "(empty)" : String(v));

/** The one next step for the rule: simulate, ask to publish, or approve someone else's request. */
export function RuleNextStep({ ruleId, step }: { ruleId: string; step: "simulate" | "request" | "approve" | "waiting" | "none" }) {
  const router = useRouter();
  const [sim, setSim] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (url: string, body?: unknown) =>
    start(async () => {
      const r = await call(url, "POST", body);
      if (!r.ok) return setError(r.message ?? null);
      setError(null);
      if (url.endsWith("/simulate")) setSim(r.data as Simulation);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {step === "simulate" || step === "request" || step === "waiting" ? (
          <Button variant={step === "simulate" ? "default" : "outline"} disabled={pending} onClick={() => run(`/api/v1/identities/rules/${ruleId}/simulate`)}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Simulate
          </Button>
        ) : null}
        {step === "request" ? (
          <Button disabled={pending} onClick={() => run(`/api/v1/identities/rules/${ruleId}/publish`, { action: "request" })}>
            Ask to publish
          </Button>
        ) : null}
        {step === "approve" ? (
          <Button disabled={pending} onClick={() => run(`/api/v1/identities/rules/${ruleId}/publish`, { action: "approve" })}>
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
      {sim ? (
        <div role="status" className="space-y-2 rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-foreground">
            Would change {sim.wouldChange} of {sim.evaluated} identities{sim.truncated ? " (the first ones in scope)" : ""}; {sim.matched} matched.
          </p>
          {sim.changes.length ? (
            <ul className="space-y-1 text-muted-foreground">
              {sim.changes.map((c, i) => (
                <li key={`${c.identityId}-${c.attribute}-${i}`}>
                  <span className="text-foreground">{c.displayName}</span>: {c.attribute} {show(c.before)} → {show(c.after)}
                </li>
              ))}
            </ul>
          ) : null}
          {sim.skipped.length ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">{sim.skipped.length} left as they are</summary>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {sim.skipped.map((s, i) => (
                  <li key={`${s.identityId}-${s.attribute}-${i}`}>
                    {s.displayName}: {s.attribute}, {s.reason}
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

export function RetireRuleButton({ ruleId }: { ruleId: string }) {
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
            const r = await call(`/api/v1/identities/rules/${ruleId}/retire`, "POST");
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
