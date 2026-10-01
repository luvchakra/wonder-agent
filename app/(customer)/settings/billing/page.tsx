import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr, type BadgeTone } from "@/modules/ui";
import { getBillingOverview } from "@/modules/billing/service";
import { defaultCurrencyFor, formatMoney, planLabel } from "@/modules/billing/rules";
import { PLAN_DEFAULTS } from "@/modules/platform-admin/service";
import type { InvoiceStatus, SubscriptionStatus } from "@/lib/shared/types/platform";
import { BillingProfileForm, PlanPicker, SubscriptionActions } from "./BillingForms";

// PLATFORM-P1-04 — Billing: plan, usage, payment (Stripe / Razorpay hosted
// pages), billing details and invoices. Viewing needs billing.view;
// every change needs billing.manage, checked again by each action.

export const metadata = { title: "Billing" };

const STATUS_TONE: Record<SubscriptionStatus, BadgeTone> = {
  active: "success",
  trialing: "info",
  past_due: "warning",
  incomplete: "warning",
  paused: "neutral",
  cancelled: "danger",
};
const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment overdue",
  incomplete: "Awaiting payment",
  paused: "Paused",
  cancelled: "Cancelled",
};
const INVOICE_TONE: Record<InvoiceStatus, BadgeTone> = {
  paid: "success",
  open: "warning",
  void: "neutral",
  uncollectible: "danger",
  refunded: "neutral",
  partially_refunded: "info",
};
const USAGE_LABEL: Record<string, string> = { users: "People", agents: "AI agents", integrations: "Integrations", runtime_events_per_month: "Runtime events this month" };

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("billing.view");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const [overview, sp] = await Promise.all([getBillingOverview(ctx.tenantId!), searchParams]);
  const canManage = ctx.permissions.includes("billing.manage");
  const sub = overview.subscription;
  const paid = !!sub && sub.provider !== undefined && sub.provider !== "manual" && sub.status !== "cancelled";
  const anyProvider = overview.providers.stripe || overview.providers.razorpay;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Billing</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Your plan, usage and invoices. Payments are taken on Stripe&apos;s or Razorpay&apos;s secure pages; WonderID never sees card or bank details.
        </p>
      </div>

      {sp.checkout === "success" ? (
        <p role="status" className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
          Payment submitted. Your plan changes here as soon as the payment provider confirms it, usually within a minute.
        </p>
      ) : sp.checkout === "cancelled" ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Checkout was cancelled. Nothing was charged.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader title="Current plan" />
          <CardBody className="space-y-3">
            {sub ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold text-foreground">{planLabel(sub.plan)}</span>
                  <Badge tone={STATUS_TONE[sub.status]}>{STATUS_LABEL[sub.status]}</Badge>
                  {sub.cancelAtPeriodEnd ? <Badge tone="warning">Ends {fmtDate(sub.currentPeriodEnd)}</Badge> : null}
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Billed through</dt>
                    <dd className="text-foreground">{sub.provider === "stripe" ? "Stripe" : sub.provider === "razorpay" ? "Razorpay" : "Contract / assigned by WonderID"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{sub.cancelAtPeriodEnd ? "Access until" : "Renews"}</dt>
                    <dd className="text-foreground">{fmtDate(sub.currentPeriodEnd)}</dd>
                  </div>
                </dl>
                {sub.status === "past_due" ? (
                  <p role="alert" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    The last payment did not go through. Update the payment method to keep this plan.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No plan is assigned yet; the organization has no usage limits applied.</p>
            )}
            {canManage && paid ? (
              <SubscriptionActions canPortal={overview.canOpenPortal} canCancel={!sub!.cancelAtPeriodEnd} canResume={!!sub!.cancelAtPeriodEnd && sub!.provider === "stripe"} />
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Usage" description="Against this plan's limits" />
          <CardBody>
            <ul className="space-y-3">
              {overview.usage.map((u) => {
                const pct = u.limit ? Math.min(100, Math.round((u.current / u.limit) * 100)) : 0;
                return (
                  <li key={u.resource}>
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground">{USAGE_LABEL[u.resource] ?? u.resource}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {u.current.toLocaleString()} {u.limit !== null ? `/ ${u.limit.toLocaleString()}` : ""}
                      </span>
                    </div>
                    {u.limit !== null ? (
                      <div className="mt-1 h-1.5 rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${USAGE_LABEL[u.resource] ?? u.resource} usage`}>
                        <div className={u.status === "hard_block" ? "h-1.5 rounded-full bg-destructive" : u.status === "soft_warning" ? "h-1.5 rounded-full bg-warning" : "h-1.5 rounded-full bg-primary"} style={{ width: `${pct}%` }} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </div>

      {canManage && !paid ? (
        <Card>
          <CardHeader title="Choose a plan" description="Billed in advance; cancel any time, effective at the end of the paid period." />
          <CardBody>
            {anyProvider ? (
              <PlanPicker
                prices={overview.prices}
                defaultCurrency={defaultCurrencyFor(overview.profile?.country ?? "US")}
                currentPriceId={sub?.priceId ?? null}
                blocked={!overview.profile}
                limits={{ pro: PLAN_DEFAULTS.pro, max: PLAN_DEFAULTS.max }}
              />
            ) : (
              <EmptyState title="Online payment is not set up on this deployment" description="Contact your WonderID account team to change plan." />
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Billing details" description="The legal entity on your invoices, and its tax registration (GSTIN for India, VAT elsewhere)." />
        <CardBody>
          <BillingProfileForm profile={overview.profile} canManage={canManage} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Invoices" description={overview.invoiceCount > overview.invoices.length ? `Latest ${overview.invoices.length} of ${overview.invoiceCount}` : undefined} />
        <CardBody>
          {overview.invoices.length === 0 ? (
            <EmptyState title="No invoices yet" description="Invoices appear here once a payment is made." />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th hideBelow="lg">Tax</Th>
                  <Th>Total</Th>
                  <Th hideBelow="lg">Document</Th>
                </tr>
              </Thead>
              <tbody>
                {overview.invoices.map((inv) => (
                  <Tr key={inv.id}>
                    <Td className="font-mono text-xs">{inv.invoiceNumber ?? inv.providerNumber ?? "Pending"}</Td>
                    <Td>{fmtDate(inv.paidAt ?? inv.issuedAt)}</Td>
                    <Td>
                      <Badge tone={INVOICE_TONE[inv.status]}>{inv.status.replace("_", " ")}</Badge>
                    </Td>
                    <Td hideBelow="lg" className="tabular-nums">
                      {formatMoney(inv.taxAmount, inv.currency)}
                      {inv.taxBreakdown.length ? <span className="block text-xs text-muted-foreground">{inv.taxBreakdown.map((t) => t.name).join(" + ")}</span> : null}
                    </Td>
                    <Td className="tabular-nums">
                      {formatMoney(inv.total, inv.currency)}
                      {inv.amountRefunded > 0 ? <span className="block text-xs text-muted-foreground">Refunded {formatMoney(inv.amountRefunded, inv.currency)}</span> : null}
                    </Td>
                    <Td hideBelow="lg">
                      {inv.invoicePdfUrl || inv.hostedInvoiceUrl ? (
                        <a href={inv.invoicePdfUrl ?? inv.hostedInvoiceUrl ?? undefined} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          View
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">In WonderID ledger</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
