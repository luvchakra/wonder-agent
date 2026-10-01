"use client";

import { useActionState, useMemo, useState } from "react";
import {
  cancelSubscriptionAction,
  openPortalAction,
  resumeSubscriptionAction,
  saveBillingProfileAction,
  startCheckoutAction,
  type BillingActionState,
} from "@/app/actions/billing";
import { Button, PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import type { BillingPrice, BillingProfile } from "@/lib/shared/types/platform";
import { BILLING_COUNTRIES } from "@/modules/billing/countries";
import { GST_STATE_CODES, formatMoney, planLabel } from "@/modules/billing/rules";

/**
 * PLATFORM-P1-04 — the Billing screen's forms. Each waits for the server's
 * answer and shows it as given (§15, §17.5); cancelling asks first.
 */

const initial: BillingActionState = { ok: false, message: null };

function Result({ state }: { state: BillingActionState }) {
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

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null;
}

export function BillingProfileForm({ profile, canManage }: { profile: BillingProfile | null; canManage: boolean }) {
  const [state, action] = useActionState(saveBillingProfileAction, initial);
  const [country, setCountry] = useState(profile?.country ?? "IN");
  const errors = state.errors ?? {};
  const disabled = !canManage;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="bp-legal" className={fieldLabelClass}>
          Legal name to invoice <span className="text-destructive">*</span>
        </label>
        <input id="bp-legal" name="legalName" required minLength={2} maxLength={200} defaultValue={profile?.legalName ?? ""} disabled={disabled} className={fieldInputClass} aria-invalid={!!errors.legalName} />
        <FieldError message={errors.legalName} />
      </div>
      <div>
        <label htmlFor="bp-email" className={fieldLabelClass}>
          Billing email <span className="text-destructive">*</span>
        </label>
        <input id="bp-email" name="billingEmail" type="email" required maxLength={320} defaultValue={profile?.billingEmail ?? ""} disabled={disabled} className={fieldInputClass} aria-invalid={!!errors.billingEmail} />
        <FieldError message={errors.billingEmail} />
      </div>
      <div>
        <label htmlFor="bp-country" className={fieldLabelClass}>
          Country <span className="text-destructive">*</span>
        </label>
        <select id="bp-country" name="country" value={country} onChange={(e) => setCountry(e.target.value)} disabled={disabled} className={fieldInputClass} aria-invalid={!!errors.country}>
          {BILLING_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <FieldError message={errors.country} />
      </div>
      <div>
        <label htmlFor="bp-region" className={fieldLabelClass}>
          {country === "IN" ? "State (place of supply)" : "State / region"}
        </label>
        {country === "IN" ? (
          <select id="bp-region" name="region" defaultValue={profile?.region ?? ""} disabled={disabled} className={fieldInputClass} aria-invalid={!!errors.region}>
            <option value="">Choose a state</option>
            {Object.entries(GST_STATE_CODES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input id="bp-region" name="region" maxLength={100} defaultValue={profile?.region ?? ""} disabled={disabled} className={fieldInputClass} />
        )}
        <FieldError message={errors.region} />
      </div>
      <div>
        <label htmlFor="bp-city" className={fieldLabelClass}>
          City
        </label>
        <input id="bp-city" name="city" maxLength={100} defaultValue={profile?.city ?? ""} disabled={disabled} className={fieldInputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="bp-line1" className={fieldLabelClass}>
          Address
        </label>
        <input id="bp-line1" name="addressLine1" maxLength={200} defaultValue={profile?.addressLine1 ?? ""} disabled={disabled} className={fieldInputClass} />
        <input aria-label="Address line 2" name="addressLine2" maxLength={200} defaultValue={profile?.addressLine2 ?? ""} disabled={disabled} className={cn(fieldInputClass, "mt-2")} />
      </div>
      <div>
        <label htmlFor="bp-postal" className={fieldLabelClass}>
          Postal code
        </label>
        <input id="bp-postal" name="postalCode" maxLength={20} defaultValue={profile?.postalCode ?? ""} disabled={disabled} className={fieldInputClass} />
      </div>
      <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
        <div>
          <label htmlFor="bp-taxtype" className={fieldLabelClass}>
            Tax id
          </label>
          <select id="bp-taxtype" name="taxIdType" defaultValue={profile?.taxIdType ?? ""} disabled={disabled} className={fieldInputClass} aria-invalid={!!errors.taxIdType}>
            <option value="">None</option>
            <option value="in_gst">GSTIN</option>
            <option value="eu_vat">EU VAT</option>
            <option value="gb_vat">UK VAT</option>
            <option value="au_abn">AU ABN</option>
            <option value="us_ein">US EIN</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor="bp-taxid" className={fieldLabelClass}>
            Number
          </label>
          <input id="bp-taxid" name="taxId" maxLength={40} defaultValue={profile?.taxId ?? ""} disabled={disabled} className={fieldInputClass} aria-invalid={!!errors.taxId} />
        </div>
        <div className="col-span-2">
          <FieldError message={errors.taxIdType ?? errors.taxId} />
        </div>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Result state={state} />
        {canManage ? (
          <PendingSubmitButton size="sm" pendingLabel="Saving…">
            Save billing details
          </PendingSubmitButton>
        ) : (
          <p className="text-xs text-muted-foreground">You can view these details; changing them needs the Manage billing permission.</p>
        )}
      </div>
    </form>
  );
}

export type PlanLimits = { maxUsers: number; maxAgents: number; maxIntegrations: number; maxRuntimeEventsPerMonth: number; auditRetentionDays: number };

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n);

function PriceCard({ price, current, disabled, limits }: { price: BillingPrice; current: boolean; disabled: boolean; limits: PlanLimits }) {
  const [state, action] = useActionState(startCheckoutAction, initial);
  return (
    <form action={action} className={cn("flex flex-col gap-3 rounded-lg border p-4", current ? "border-primary bg-primary/5" : "border-border")}>
      <input type="hidden" name="priceId" value={price.id} />
      <div>
        <p className="text-sm font-semibold text-foreground">{planLabel(price.plan)}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {formatMoney(price.unitAmount, price.currency)}
          <span className="ml-1 text-sm font-normal text-muted-foreground">/{price.interval === "month" ? "month" : "year"}</span>
        </p>
        <p className="text-xs text-muted-foreground">{price.taxBehavior === "inclusive" ? "Includes GST" : "Plus applicable tax"}</p>
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li>
          Up to {compact(limits.maxUsers)} people and {compact(limits.maxAgents)} AI agents
        </li>
        <li>
          {compact(limits.maxIntegrations)} integrations, {compact(limits.maxRuntimeEventsPerMonth)} runtime events / month
        </li>
        <li>{limits.auditRetentionDays >= 365 ? `${Math.round(limits.auditRetentionDays / 365)}-year` : `${limits.auditRetentionDays}-day`} audit retention</li>
      </ul>
      <Result state={state} />
      <div className="mt-auto">
        {current ? (
          <p className="text-xs font-medium text-primary">Your current plan</p>
        ) : (
          <PendingSubmitButton size="sm" pendingLabel="Opening checkout…" variant={disabled ? "outline" : "default"}>
            Choose {planLabel(price.plan)}
          </PendingSubmitButton>
        )}
      </div>
    </form>
  );
}

export function PlanPicker({
  prices,
  defaultCurrency,
  currentPriceId,
  blocked,
  limits,
}: {
  prices: BillingPrice[];
  defaultCurrency: string;
  currentPriceId: string | null;
  blocked: boolean;
  limits: Record<"pro" | "max", PlanLimits>;
}) {
  const currencies = useMemo(() => [...new Set(prices.map((p) => p.currency))].sort(), [prices]);
  const [interval, setBillingInterval] = useState<"month" | "year">("month");
  const [currency, setCurrency] = useState(currencies.includes(defaultCurrency) ? defaultCurrency : (currencies[0] ?? "USD"));
  const shown = prices.filter((p) => p.interval === interval && p.currency === currency);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Billing interval" className="inline-flex rounded-md border border-border p-0.5">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              onClick={() => setBillingInterval(i)}
              className={cn("rounded px-3 py-1 text-sm", interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {i === "month" ? "Monthly" : "Yearly (2 months free)"}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="plan-currency">
          Currency
        </label>
        <select id="plan-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={cn(fieldInputClass, "w-auto")}>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {blocked ? <p className="text-xs text-muted-foreground">Add the billing details below before choosing a plan.</p> : null}
      <div className="grid gap-3 md:grid-cols-3">
        {shown.map((p) => (
          <PriceCard key={p.id} price={p} current={p.id === currentPriceId} disabled={blocked} limits={limits[p.plan]} />
        ))}
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Enterprise</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">Custom</p>
            <p className="text-xs text-muted-foreground">Annual contract, invoiced</p>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>Unlimited people, agents and integrations</li>
            <li>7-year audit retention for SOX evidence</li>
            <li>Data processing agreement and security review</li>
          </ul>
          <p className="mt-auto text-xs text-muted-foreground">Contact your WonderID account team.</p>
        </div>
      </div>
    </div>
  );
}

export function SubscriptionActions({ canPortal, canCancel, canResume }: { canPortal: boolean; canCancel: boolean; canResume: boolean }) {
  const [portalState, portalAction] = useActionState(openPortalAction, initial);
  const [cancelState, cancelAction] = useActionState(cancelSubscriptionAction, initial);
  const [resumeState, resumeAction] = useActionState(resumeSubscriptionAction, initial);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canPortal ? (
          <form action={portalAction}>
            <PendingSubmitButton size="sm" variant="outline" pendingLabel="Opening…">
              Manage payment methods and invoices
            </PendingSubmitButton>
          </form>
        ) : null}
        {canResume ? (
          <form action={resumeAction}>
            <PendingSubmitButton size="sm" variant="outline" pendingLabel="Withdrawing…">
              Keep my plan
            </PendingSubmitButton>
          </form>
        ) : null}
        {canCancel && !confirming ? (
          <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
            Cancel subscription
          </Button>
        ) : null}
      </div>
      {canCancel && confirming ? (
        <form action={cancelAction} className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-foreground">The plan stays active until the end of the paid period, then the organization moves to the Free plan&apos;s limits. Nothing is deleted.</p>
          <div className="flex gap-2">
            <PendingSubmitButton size="sm" variant="destructive" pendingLabel="Scheduling…">
              Cancel at period end
            </PendingSubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep subscription
            </Button>
          </div>
        </form>
      ) : null}
      <Result state={portalState} />
      <Result state={cancelState} />
      <Result state={resumeState} />
    </div>
  );
}
