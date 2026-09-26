"use client";

import { useState } from "react";
import { fieldInputClass, fieldLabelClass } from "@/modules/ui";

/**
 * FOUNDATION-P0-19 — the terms of a role assignment, shared by the user
 * and group screens: where it applies (the organization, environments,
 * applications or agents), when (start, expiry) and under what condition
 * (MFA). Collapsed by default: most assignments are organization-wide and
 * permanent. The server validates the same fields (assignmentRules.ts),
 * and the database again (migration 0100).
 */

export type ScopeOption = { id: string; label: string };

const ENVIRONMENTS = [
  { id: "production", label: "Production" },
  { id: "staging", label: "Staging" },
  { id: "development", label: "Development" },
];

export function AssignmentTermsFields({ idPrefix, applications, agents, errors }: { idPrefix: string; applications: ScopeOption[]; agents: ScopeOption[]; errors?: Record<string, string> }) {
  const [scope, setScope] = useState("tenant");
  const options = scope === "environment" ? ENVIRONMENTS : scope === "application" ? applications : scope === "agent" ? agents : [];
  const open = !!(errors && (errors.scopeType || errors.scopeValues || errors.startsAt || errors.expiresAt));
  return (
    <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm" open={open || undefined}>
      <summary className="cursor-pointer select-none text-sm font-medium text-foreground">Scope, timing and conditions</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-scope`} className={fieldLabelClass}>
            Applies to
          </label>
          <select id={`${idPrefix}-scope`} name="scopeType" value={scope} onChange={(e) => setScope(e.target.value)} className={fieldInputClass} aria-invalid={!!errors?.scopeType}>
            <option value="tenant">The entire organization</option>
            <option value="environment">Selected environments</option>
            <option value="application">Selected applications</option>
            <option value="agent">Selected agents</option>
          </select>
          {errors?.scopeType ? <p className="mt-1 text-xs text-destructive">{errors.scopeType}</p> : null}
        </div>
        {scope !== "tenant" ? (
          <fieldset className="sm:col-span-2">
            <legend className={fieldLabelClass}>{scope === "environment" ? "Environments" : scope === "application" ? "Applications" : "Agents"}</legend>
            {options.length ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-card p-2">
                {options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" name="scopeValues" value={o.id} className="size-4 accent-[var(--primary)]" />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">There are none in this organization yet.</p>
            )}
            {errors?.scopeValues ? <p className="mt-1 text-xs text-destructive">{errors.scopeValues}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">A scoped role applies only where WonderID checks that specific environment, application or agent.</p>
          </fieldset>
        ) : null}
        <div>
          <label htmlFor={`${idPrefix}-starts`} className={fieldLabelClass}>
            Starts <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input id={`${idPrefix}-starts`} name="startsAt" type="date" className={fieldInputClass} aria-invalid={!!errors?.startsAt} />
          {errors?.startsAt ? <p className="mt-1 text-xs text-destructive">{errors.startsAt}</p> : null}
        </div>
        <div>
          <label htmlFor={`${idPrefix}-expires`} className={fieldLabelClass}>
            Expires <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input id={`${idPrefix}-expires`} name="expiresAt" type="date" className={fieldInputClass} aria-invalid={!!errors?.expiresAt} />
          {errors?.expiresAt ? <p className="mt-1 text-xs text-destructive">{errors.expiresAt}</p> : null}
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
          <input type="checkbox" name="requiresMfa" className="size-4 accent-[var(--primary)]" />
          Only with multi-factor authentication
        </label>
      </div>
    </details>
  );
}
