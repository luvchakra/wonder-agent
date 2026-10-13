"use client";

import { useActionState, useState } from "react";
import { orderEnvironmentAction, renameOrganizationAction, setOrganizationDisabledAction, type ManageState } from "@/app/actions/organizations";
import { Button, EnvironmentBadge, environmentColor, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

export type ManageRow = { tenantId: string; name: string; environment: string; status: "active" | "suspended"; disabledByOwner: boolean; url: string | null };
export type PriceOption = { id: string; label: string };
export type ManageOrganization = ManageRow & { environments: ManageRow[]; addable: string[]; prices: PriceOption[]; testPayments: boolean };

const ENV_LABEL: Record<string, string> = { production: "Production", development: "Development", test: "Test", staging: "Staging", sandbox: "Sandbox" };
const INITIAL: ManageState = { ok: false, error: null };

function Result({ state }: { state: ManageState }) {
  if (state.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  return null;
}

/** Disable needs a second click to confirm; enable is one click. */
function DisableToggle({ row, label }: { row: ManageRow; label: string }) {
  const disabled = row.status === "suspended";
  const [state, action, pending] = useActionState(setOrganizationDisabledAction.bind(null, row.tenantId, !disabled), INITIAL);
  const [confirming, setConfirming] = useState(false);
  if (disabled && !row.disabledByOwner) return <span className="text-xs text-muted-foreground">Suspended by WonderID</span>;
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      {state.error ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
      {disabled ? (
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Enabling…" : "Enable"}
        </Button>
      ) : confirming ? (
        <>
          <span className="text-xs text-muted-foreground">Nobody can sign in to {label} until it is enabled.</span>
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            {pending ? "Disabling…" : "Disable"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          Disable…
        </Button>
      )}
    </form>
  );
}

function RenameForm({ org }: { org: ManageOrganization }) {
  const [state, action, pending] = useActionState(renameOrganizationAction.bind(null, org.tenantId), INITIAL);
  return (
    <form action={action} className="space-y-2">
      <label htmlFor={`name-${org.tenantId}`} className={fieldLabelClass}>
        Organization name
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={`name-${org.tenantId}`} name="name" required minLength={2} maxLength={80} defaultValue={org.name} className={cn(fieldInputClass, "min-w-0 flex-1")} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Rename"}
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

function AddEnvironmentForm({ org }: { org: ManageOrganization }) {
  const [state, action, pending] = useActionState(orderEnvironmentAction.bind(null, org.tenantId), INITIAL);
  const [environment, setEnvironment] = useState(org.addable[0]);
  if (!org.testPayments) return <p className="text-sm text-muted-foreground">Online payment for environments is not available yet. Contact support to add one.</p>;
  if (!org.prices.length) return <p className="text-sm text-muted-foreground">No plan is on sale for this organization&apos;s currency.</p>;
  return (
    <form action={action} className="space-y-3">
      <fieldset>
        <legend className={fieldLabelClass}>Environment</legend>
        <div className="flex flex-wrap gap-2">
          {org.addable.map((env) => (
            <label
              key={env}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                environment === env ? environmentColor(env).badge : "border-border hover:bg-accent",
              )}
            >
              <input type="radio" name="environment" value={env} checked={environment === env} onChange={() => setEnvironment(env)} className="sr-only" />
              <span aria-hidden className={cn("size-2 rounded-full", environmentColor(env).dot)} />
              {ENV_LABEL[env] ?? env}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`price-${org.tenantId}`} className={fieldLabelClass}>
          Plan
        </label>
        <select id={`price-${org.tenantId}`} name="priceId" className={fieldInputClass} defaultValue={org.prices[0].id}>
          {org.prices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">Test payment: no money is charged while online payment is being set up.</p>
      <Button type="submit" disabled={pending}>
        {pending ? "Setting up…" : "Pay and set up"}
      </Button>
      <Result state={state} />
    </form>
  );
}

/**
 * Owner request (2026-10-13): one organization the person owns, with its
 * environments. Rename and Add environment are folded (§19.5); each
 * environment row carries one action, Disable or Enable.
 */
export function ManageOrganizationCard({ org }: { org: ManageOrganization }) {
  const rows = [org, ...org.environments];
  const orgDisabled = org.status === "suspended";
  return (
    <section aria-label={org.name} className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{org.name}</h2>
        {orgDisabled ? <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Disabled</span> : null}
        <DisableToggle key={org.status} row={org} label="the organization and its environments" />
      </header>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.tenantId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <EnvironmentBadge environment={r.environment} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {r.url && r.status === "active" ? (
                <a href={`${r.url}/sign-in`} className="hover:text-foreground hover:underline">
                  {r.url.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                (r.url?.replace(/^https?:\/\//, "") ?? r.name)
              )}
            </span>
            {r.status === "suspended" ? <span className="text-xs text-muted-foreground">Disabled</span> : null}
            {r.tenantId !== org.tenantId && !orgDisabled ? <DisableToggle key={r.status} row={r} label="this environment" /> : null}
          </li>
        ))}
      </ul>
      <div className="space-y-1 border-t border-border">
        <details className="group px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-primary">Rename</summary>
          <div className="mt-3">
            <RenameForm org={org} />
          </div>
        </details>
        {org.addable.length && !orgDisabled ? (
          <details className="group border-t border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-primary">Add environment</summary>
            <div className="mt-3">
              <AddEnvironmentForm org={org} />
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
