"use client";

import { useMemo, useState } from "react";
import { Check, Mail } from "lucide-react";
import { LinkButton } from "@/modules/ui";
import { cn } from "@/lib/utils";

/**
 * The landing page's plans and prices. Prices come from WonderID's own
 * billing catalogue (billing_prices, the same rows checkout charges), and
 * limits from the plan definitions, so the page can never advertise a
 * number the product doesn't bill or enforce. If the catalogue couldn't be
 * read, no price is shown at all — "contact us" rather than a stale guess.
 */

export type PublicPrice = { plan: "pro" | "max"; interval: "month" | "year"; currency: string; unitAmount: number; taxBehavior: "inclusive" | "exclusive" };
export type PlanLimits = { maxUsers: number; maxAgents: number; maxIntegrations: number; maxRuntimeEventsPerMonth: number; auditRetentionDays: number };

const CURRENCY_LOCALE: Record<string, string> = { USD: "en-US", EUR: "de-DE", INR: "en-IN" };

function money(minor: number, currency: string, whole = false) {
  const amount = minor / 100;
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: whole || Number.isInteger(amount) ? 0 : 2,
  }).format(whole ? Math.round(amount) : amount);
}

const count = (n: number) => new Intl.NumberFormat("en-US").format(n);
const retention = (days: number) => (days >= 730 ? `${Math.round(days / 365)} years` : days >= 365 ? "1 year" : `${days} days`);

function limitLines(l: PlanLimits) {
  return [
    `${count(l.maxUsers)} ${l.maxUsers === 1 ? "user" : "users"}`,
    `${count(l.maxAgents)} AI agents`,
    `${count(l.maxIntegrations)} ${l.maxIntegrations === 1 ? "integration" : "integrations"}`,
    `${count(l.maxRuntimeEventsPerMonth)} runtime events a month`,
    `${retention(l.auditRetentionDays)} of audit history`,
  ];
}

export function Pricing({ prices, limits }: { prices: PublicPrice[] | null; limits: Record<"free" | "pro" | "max" | "enterprise", PlanLimits> }) {
  const currencies = useMemo(() => [...new Set((prices ?? []).map((p) => p.currency))].sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b))), [prices]);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [currency, setCurrency] = useState(currencies[0] ?? "USD");
  const priceOf = (plan: "pro" | "max", i: "month" | "year") => prices?.find((p) => p.plan === plan && p.interval === i && p.currency === currency) ?? null;
  const hasPrices = !!prices?.length;

  const paid = (plan: "pro" | "max") => {
    const p = priceOf(plan, interval);
    if (!p) return { amount: null, note: "Contact us for pricing" };
    const monthly = priceOf(plan, "month");
    const saving = interval === "year" && monthly ? Math.round((1 - p.unitAmount / (monthly.unitAmount * 12)) * 100) : 0;
    const tax = p.taxBehavior === "inclusive" ? (currency === "INR" ? "incl. GST" : "tax included") : "plus applicable tax";
    return {
      amount: money(p.unitAmount, currency),
      per: interval === "month" ? "/ month" : "/ year",
      note: interval === "year" ? `About ${money(p.unitAmount / 12, currency, true)} a month, billed yearly${saving > 0 ? ` · save ${saving}%` : ""} · ${tax}` : `Billed monthly · ${tax}`,
    };
  };

  const plans = [
    { key: "free", name: "Free", blurb: "Try WonderID on a small team and its first agents.", price: { amount: money(0, currency), per: "", note: "No card needed" }, lines: limitLines(limits.free), cta: { label: "Get started", href: "/sign-up" } },
    { key: "pro", name: "Pro", blurb: "For a team governing its identities and agents in production.", price: paid("pro"), lines: limitLines(limits.pro), cta: { label: "Start with Pro", href: "/sign-up" } },
    { key: "max", name: "Max", blurb: "For organizations running many agents across many systems.", price: paid("max"), lines: limitLines(limits.max), cta: { label: "Start with Max", href: "/sign-up" } },
    {
      key: "enterprise",
      name: "Enterprise",
      blurb: "For large organizations that need custom terms and scale.",
      price: { amount: "Custom", per: "", note: "Priced for your organization" },
      lines: ["Limits sized to your organization", `${retention(limits.enterprise.auditRetentionDays)} of audit history`, "Annual contract and invoicing"],
      cta: { label: "Talk to us", href: "mailto:connect@wonderapps.biz?subject=WonderID%20Enterprise" },
    },
  ] as const;

  return (
    <div className="mt-10 space-y-6">
      {hasPrices ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Billing period" className="inline-flex rounded-full border border-border bg-card p-1 text-sm">
            {(["month", "year"] as const).map((i) => (
              <button
                key={i}
                type="button"
                aria-pressed={interval === i}
                onClick={() => setInterval(i)}
                className={cn("rounded-full px-4 py-1.5 font-medium transition-colors", interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {i === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground">
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <li key={plan.key} className={cn("flex flex-col rounded-xl border bg-card p-6", plan.key === "pro" ? "border-primary/50 shadow-[var(--shadow-sm)]" : "border-border")}>
            <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
            <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.blurb}</p>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className={cn("font-semibold tracking-[-0.02em] text-foreground", plan.price.amount ? "text-3xl" : "text-lg")}>{plan.price.amount ?? "—"}</span>
              {"per" in plan.price && plan.price.per ? <span className="text-sm text-muted-foreground">{plan.price.per}</span> : null}
            </p>
            <p className="mt-1 min-h-8 text-xs text-muted-foreground">{plan.price.note}</p>
            <ul className="mt-5 flex-1 space-y-2 text-sm text-foreground">
              {plan.lines.map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <LinkButton href={plan.cta.href} variant={plan.key === "pro" ? "default" : "outline"} className="mt-6 w-full rounded-full">
              {plan.key === "enterprise" ? <Mail className="size-4" aria-hidden="true" /> : null}
              {plan.cta.label}
            </LinkButton>
          </li>
        ))}
      </ul>

      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Every plan includes the whole product — identities, non-human identities, AI agents, access requests, certifications, risk and audit. Plans differ only
        in scale and how long audit history is kept. Choose or change a paid plan in Administration → Billing after you create your organization; you pay on
        Stripe&rsquo;s or Razorpay&rsquo;s secure page, and cancelling takes effect at the end of the period you paid for.
      </p>
    </div>
  );
}
