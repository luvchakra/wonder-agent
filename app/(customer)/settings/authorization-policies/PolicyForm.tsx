"use client";

import { useActionState, useMemo, useState } from "react";
import { deletePolicyAction, savePolicyAction, setPolicyStatusAction, type PolicyActionState } from "@/app/actions/authorizationPolicies";
import { Button, PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

/**
 * FOUNDATION-P0-19 — create and edit an authorization policy: what it
 * does (deny, or require approval), to which permissions (chosen from the
 * catalog, or a prefix such as `runtime.*`), where (the organization, or
 * environments, applications or agents), and who is exempt (break glass).
 */

export type PolicyFormValues = {
  id?: string;
  name: string;
  description: string | null;
  effect: "DENY" | "REQUIRE_APPROVAL";
  permissions: string[];
  scopeType: string;
  scopeValues: string[];
  exemptRoleIds: string[];
};

type Option = { id: string; label: string };
type CatalogGroup = { module: string; label: string; permissions: { key: string; label: string }[] };

const initial: PolicyActionState = { ok: false, message: null };
const ENVIRONMENTS: Option[] = [
  { id: "production", label: "Production" },
  { id: "staging", label: "Staging" },
  { id: "development", label: "Development" },
];

function Result({ state }: { state: PolicyActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn("rounded-md border px-3 py-2 text-sm", state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}
    >
      {state.message}
    </p>
  );
}

export function PolicyForm({
  values,
  catalog,
  roles,
  applications,
  agents,
  submitLabel,
}: {
  values: PolicyFormValues;
  catalog: CatalogGroup[];
  roles: Option[];
  applications: Option[];
  agents: Option[];
  submitLabel: string;
}) {
  const [state, action] = useActionState(savePolicyAction, initial);
  const errors = state.errors ?? {};
  const [scope, setScope] = useState(values.scopeType);
  const [filter, setFilter] = useState("");
  const catalogKeys = useMemo(() => new Set(catalog.flatMap((g) => g.permissions.map((p) => p.key))), [catalog]);
  const prefixes = values.permissions.filter((p) => !catalogKeys.has(p)).join(" ");
  const q = filter.trim().toLowerCase();
  const scopeOptions = scope === "environment" ? ENVIRONMENTS : scope === "application" ? applications : scope === "agent" ? agents : [];

  return (
    <form action={action} className="space-y-5">
      {values.id ? <input type="hidden" name="policyId" value={values.id} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="policy-name" className={fieldLabelClass}>
            Policy name
          </label>
          <input id="policy-name" name="name" required minLength={2} maxLength={120} defaultValue={values.name} className={fieldInputClass} aria-invalid={!!errors.name} />
          {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
        </div>
        <fieldset>
          <legend className={fieldLabelClass}>Effect</legend>
          <div className="flex flex-wrap gap-4 pt-1.5 text-sm text-foreground">
            <label className="flex items-center gap-2">
              <input type="radio" name="effect" value="DENY" defaultChecked={values.effect === "DENY"} className="size-4 accent-[var(--primary)]" />
              Deny
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="effect" value="REQUIRE_APPROVAL" defaultChecked={values.effect === "REQUIRE_APPROVAL"} className="size-4 accent-[var(--primary)]" />
              Require approval
            </label>
          </div>
          {errors.effect ? <p className="mt-1 text-xs text-destructive">{errors.effect}</p> : null}
        </fieldset>
        <div className="md:col-span-2">
          <label htmlFor="policy-description" className={fieldLabelClass}>
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea id="policy-description" name="description" rows={2} maxLength={500} defaultValue={values.description ?? ""} className={fieldInputClass} />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className={fieldLabelClass}>Permissions it applies to</legend>
        <input type="search" aria-label="Search permissions" placeholder="Search permissions" value={filter} onChange={(e) => setFilter(e.target.value)} className={fieldInputClass} />
        <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border bg-card p-3">
          {catalog.map((g) => {
            const shown = g.permissions.filter((p) => !q || p.key.includes(q) || p.label.toLowerCase().includes(q));
            return (
              <div key={g.module} className={shown.length ? "" : "hidden"}>
                <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{g.label}</p>
                {g.permissions.map((p) => (
                  <label key={p.key} className={cn("flex items-center gap-2 py-0.5 text-sm text-foreground", shown.includes(p) ? "" : "hidden")}>
                    <input type="checkbox" name="permissions" value={p.key} defaultChecked={values.permissions.includes(p.key)} disabled={p.key === "tenant.security.manage"} className="size-4 accent-[var(--primary)]" />
                    <span className="min-w-0 truncate">{p.label}</span>
                    <code className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{p.key}</code>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <div>
          <label htmlFor="policy-prefixes" className={fieldLabelClass}>
            Or by prefix <span className="font-normal text-muted-foreground">(optional, e.g. runtime.*)</span>
          </label>
          <input id="policy-prefixes" name="prefixes" defaultValue={prefixes} className={fieldInputClass} />
        </div>
        {errors.permissions ? <p className="text-xs text-destructive">{errors.permissions}</p> : null}
        <p className="text-xs text-muted-foreground">tenant.security.manage can&apos;t be covered: it is how a policy is undone.</p>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="policy-scope" className={fieldLabelClass}>
            Applies to
          </label>
          <select id="policy-scope" name="scopeType" value={scope} onChange={(e) => setScope(e.target.value)} className={fieldInputClass}>
            <option value="tenant">The entire organization</option>
            <option value="environment">Selected environments</option>
            <option value="application">Selected applications</option>
            <option value="agent">Selected agents</option>
          </select>
          {scope !== "tenant" ? (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-card p-2">
              {scopeOptions.length ? (
                scopeOptions.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" name="scopeValues" value={o.id} defaultChecked={values.scopeValues.includes(o.id)} className="size-4 accent-[var(--primary)]" />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">There are none in this organization yet.</p>
              )}
            </div>
          ) : null}
          {errors.scopeValues ? <p className="mt-1 text-xs text-destructive">{errors.scopeValues}</p> : null}
          {scope !== "tenant" ? <p className="mt-1 text-xs text-muted-foreground">A scoped policy applies where WonderID checks that specific environment, application or agent.</p> : null}
        </div>
        <fieldset>
          <legend className={fieldLabelClass}>Exempt roles (break glass)</legend>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-card p-2">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" name="exemptRoleIds" value={r.id} defaultChecked={values.exemptRoleIds.includes(r.id)} className="size-4 accent-[var(--primary)]" />
                <span className="truncate">{r.label}</span>
              </label>
            ))}
          </div>
          {errors.exemptRoleIds ? <p className="mt-1 text-xs text-destructive">{errors.exemptRoleIds}</p> : null}
        </fieldset>
      </div>

      <Result state={state} />
      <PendingSubmitButton size="sm" pendingLabel="Saving…">
        {submitLabel}
      </PendingSubmitButton>
    </form>
  );
}

export function PolicyStatusActions({ id, status }: { id: string; status: "active" | "inactive" }) {
  const [statusState, statusAction] = useActionState(setPolicyStatusAction, initial);
  const [deleteState, deleteAction] = useActionState(deletePolicyAction, initial);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={statusAction}>
          <input type="hidden" name="policyId" value={id} />
          <input type="hidden" name="status" value={status === "active" ? "inactive" : "active"} />
          <PendingSubmitButton size="sm" variant="outline" pendingLabel="Saving…">
            {status === "active" ? "Deactivate" : "Activate"}
          </PendingSubmitButton>
        </form>
        {confirm ? (
          <form action={deleteAction} className="flex items-center gap-2">
            <input type="hidden" name="policyId" value={id} />
            <PendingSubmitButton size="sm" variant="destructive" pendingLabel="Deleting…">
              Delete policy
            </PendingSubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>
            Delete
          </Button>
        )}
      </div>
      <Result state={statusState} />
      <Result state={deleteState} />
    </div>
  );
}
