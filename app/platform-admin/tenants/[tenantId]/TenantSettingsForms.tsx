"use client";

import { useActionState } from "react";
import {
  changePlanAction,
  renameOrganizationAction,
  renameTenantSlugAction,
  saveOrganizationProfileAction,
  setOrganizationPlanAction,
  setTenantEnvironmentAction,
  setTenantNotesAction,
  type TenantSettingState,
} from "@/app/actions/platform";
import type { OrganizationProfile } from "@/modules/platform-admin/organizationProfileRules";
import { Button, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

const ENVIRONMENTS = [
  ["production", "Production"],
  ["development", "Development"],
  ["test", "Test"],
  ["staging", "Staging"],
  ["sandbox", "Sandbox"],
] as const;

function Result({ state }: { state: TenantSettingState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cn("text-xs", state.ok ? "text-success" : "text-destructive")}>
      {state.message}
    </p>
  );
}

/** Owner request 2026-10-13: change the address prefix at any time. */
export function AddressForm({ tenantId, slug, base }: { tenantId: string; slug: string; base: string | null }) {
  const [state, action, pending] = useActionState<TenantSettingState, FormData>(renameTenantSlugAction.bind(null, tenantId), { ok: false, message: null });
  return (
    <form action={action} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input name="slug" aria-label="Address prefix" defaultValue={slug} required minLength={3} maxLength={40} className={cn(fieldInputClass, "w-56 font-mono")} />
        {base ? <span className="font-mono text-xs text-muted-foreground">.{base}</span> : null}
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Change address"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">The old address stops working at once; people sign in at the new one.</p>
      <Result state={state} />
    </form>
  );
}

/** Owner request 2026-10-13: change the environment chosen at the start. */
export function EnvironmentForm({ tenantId, environment }: { tenantId: string; environment: string }) {
  const [state, action, pending] = useActionState<TenantSettingState, FormData>(setTenantEnvironmentAction.bind(null, tenantId), { ok: false, message: null });
  return (
    <form action={action} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select name="environment" aria-label="Environment" defaultValue={environment} className={cn(fieldInputClass, "w-44")}>
          {ENVIRONMENTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

/** Owner request 2026-10-13: change the plan after it was assigned. */
export function PlanForm({ tenantId, plan, organization = false }: { tenantId: string; plan: string | null; organization?: boolean }) {
  const [state, action, pending] = useActionState<TenantSettingState, FormData>((organization ? setOrganizationPlanAction : changePlanAction).bind(null, tenantId), { ok: false, message: null });
  return (
    <form action={action} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select name="plan" aria-label="Plan" defaultValue={plan ?? "free"} className={cn(fieldInputClass, "w-44")}>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="max">Max</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : plan ? "Change plan" : "Assign plan"}
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

const INITIAL: TenantSettingState = { ok: false, message: null };

/** Owner request 2026-10-13: rename the organization; its environments follow. */
export function OrganizationNameForm({ tenantId, name }: { tenantId: string; name: string }) {
  const [state, action, pending] = useActionState<TenantSettingState, FormData>(renameOrganizationAction.bind(null, tenantId), INITIAL);
  return (
    <form action={action} className="space-y-1.5">
      <label htmlFor="org-name" className={fieldLabelClass}>
        Organization name
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input id="org-name" name="name" required minLength={2} maxLength={80} defaultValue={name} className={cn(fieldInputClass, "min-w-0 flex-1 sm:max-w-sm")} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Rename"}
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** Owner request 2026-10-13: description, contacts and company details. */
export function OrganizationProfileForm({
  tenantId,
  profile,
  industries,
  sizes,
  countries,
}: {
  tenantId: string;
  profile: OrganizationProfile | null;
  industries: readonly string[];
  sizes: readonly string[];
  countries: { code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<TenantSettingState, FormData>(saveOrganizationProfileAction.bind(null, tenantId), INITIAL);
  const v = (k: keyof OrganizationProfile) => profile?.[k] ?? "";
  const input = (k: keyof OrganizationProfile, label: string, type = "text", extra: Record<string, unknown> = {}) => (
    <Field id={`p-${k}`} label={label}>
      <input id={`p-${k}`} name={k} type={type} defaultValue={v(k)} className={fieldInputClass} {...extra} />
    </Field>
  );
  return (
    <form action={action} className="space-y-5">
      <Field id="p-description" label="Description">
        <textarea id="p-description" name="description" rows={2} maxLength={1000} defaultValue={v("description")} className={fieldInputClass} />
      </Field>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium text-foreground">Contact person</legend>
        {input("contactName", "Name", "text", { maxLength: 120, autoComplete: "off" })}
        {input("contactEmail", "Email", "email", { autoComplete: "off" })}
        {input("contactPhone", "Phone", "tel", { autoComplete: "off" })}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium text-foreground">Company</legend>
        {input("companyName", "Name", "text", { maxLength: 160 })}
        {input("companyEmail", "Email", "email")}
        {input("companyPhone", "Phone", "tel")}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-medium text-foreground">Company details</legend>
        <Field id="p-industry" label="Industry">
          <select id="p-industry" name="industry" defaultValue={v("industry")} className={fieldInputClass}>
            <option value="">Not recorded</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </Field>
        <Field id="p-userBaseSize" label="User base size">
          <select id="p-userBaseSize" name="userBaseSize" defaultValue={v("userBaseSize")} className={fieldInputClass}>
            <option value="">Not recorded</option>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s} people
              </option>
            ))}
          </select>
        </Field>
        <Field id="p-country" label="Country">
          <select id="p-country" name="country" defaultValue={v("country")} className={fieldInputClass}>
            <option value="">Not recorded</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {input("website", "Website", "url", { placeholder: "https://" })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** Owner request 2026-10-13: the platform's own notes on an environment. */
export function NotesForm({ tenantId, notes }: { tenantId: string; notes: string | null }) {
  const [state, action, pending] = useActionState<TenantSettingState, FormData>(setTenantNotesAction.bind(null, tenantId), INITIAL);
  return (
    <form action={action} className="space-y-1.5">
      <textarea name="notes" aria-label="Notes" rows={3} maxLength={2000} defaultValue={notes ?? ""} className={fieldInputClass} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save notes"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}
