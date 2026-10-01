import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { redact, safeErrorMessage } from "@/lib/security/redact";
import { listPermissionHolders } from "@/lib/rbac/permissionHolders";
import type { BillingProvider, SubscriptionPlan, SubscriptionStatus, TaxLine } from "@/lib/shared/types/platform";
import { PLAN_DEFAULTS } from "@/modules/platform-admin/service";
import { notify } from "@/modules/operations/notifications";
import { supplierGst } from "./config";
import { computeGst, customerStateCode, effectivePlan, mapRazorpayStatus, mapStripeStatus } from "./rules";
import * as stripe from "./stripeClient";

/**
 * PLATFORM-P1-04 — webhook processing for Stripe and Razorpay, following
 * CLAUDE.md §17.6's intake order: the route has verified the signature;
 * here the event is persisted (idempotent on the provider's event id)
 * BEFORE it is processed, the tenant is resolved only from records
 * WonderID itself created (billing_checkouts, subscriptions,
 * billing_profiles — never from payload metadata alone, §14), stale
 * events never overwrite newer state, and each outcome is recorded.
 *
 * The returned `retry` flag tells the route to answer non-2xx so the
 * provider redelivers (e.g. a subscription event that arrived before its
 * checkout was recorded); everything else is acknowledged.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- provider payloads are untyped external JSON, read defensively */

export type WebhookOutcome = { status: "processed" | "ignored" | "duplicate" | "failed"; retry: boolean; detail?: string };

type Intake = { provider: BillingProvider; eventId: string; eventType: string; createdAt: Date | null; payload: unknown };

const db = () => supabaseServiceRole();

async function recordIntake(intake: Intake): Promise<{ id: string; duplicate: boolean }> {
  const supabase = db();
  const { data, error } = await supabase
    .from("billing_webhook_events")
    .insert({
      provider: intake.provider,
      event_id: intake.eventId,
      event_type: intake.eventType,
      signature_verified: true,
      payload: redact(intake.payload) as object,
      event_created_at: intake.createdAt?.toISOString() ?? null,
    })
    .select("id")
    .single();
  if (!error && data) return { id: data.id, duplicate: false };
  if (error?.code !== "23505") throw new Error(`webhook intake failed: ${error?.message}`);
  const { data: existing } = await supabase.from("billing_webhook_events").select("id, status, attempts").eq("provider", intake.provider).eq("event_id", intake.eventId).single();
  if (!existing) throw new Error("webhook intake conflict without a row");
  if (existing.status === "processed" || existing.status === "ignored") return { id: existing.id, duplicate: true };
  await supabase.from("billing_webhook_events").update({ attempts: (existing.attempts ?? 1) + 1, status: "received", error: null }).eq("id", existing.id);
  return { id: existing.id, duplicate: false };
}

async function finish(id: string, outcome: WebhookOutcome, tenantId: string | null): Promise<WebhookOutcome> {
  await db()
    .from("billing_webhook_events")
    .update({ status: outcome.status === "duplicate" ? "processed" : outcome.status, tenant_id: tenantId, error: outcome.detail ? safeErrorMessage(outcome.detail) : null, processed_at: new Date().toISOString() })
    .eq("id", id);
  return outcome;
}

// ---------------------------------------------------------------- shared

type SubscriptionState = {
  tenantId: string;
  provider: BillingProvider;
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  priceId: string | null;
  status: SubscriptionStatus;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** null keeps what is recorded (Razorpay sends no event for a scheduled cancellation). */
  cancelAtPeriodEnd: boolean | null;
  cancelledAt: Date | null;
  stateAt: Date;
  eventType: string;
};

/**
 * Applies a provider's subscription state to the tenant's subscription row
 * and its plan limits. Ignores a state older than the one already applied.
 */
async function applySubscriptionState(s: SubscriptionState): Promise<"applied" | "stale"> {
  const supabase = db();
  const [{ data: rows }, { data: priceRow }] = await Promise.all([
    supabase.from("subscriptions").select().eq("tenant_id", s.tenantId).order("started_at", { ascending: false }).limit(1),
    s.priceId ? supabase.from("billing_prices").select("id, plan, billing_interval, currency").eq("id", s.priceId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const current = rows?.[0] ?? null;
  if (current && current.provider_subscription_id === s.providerSubscriptionId && current.provider_state_at && new Date(current.provider_state_at) > s.stateAt) {
    return "stale";
  }
  const paidPlan: SubscriptionPlan = (priceRow?.plan as SubscriptionPlan | undefined) ?? (current?.plan as SubscriptionPlan | undefined) ?? "free";
  const plan = effectivePlan(paidPlan, s.status);
  const limits = PLAN_DEFAULTS[plan];
  const row = {
    tenant_id: s.tenantId,
    plan,
    max_users: limits.maxUsers,
    max_agents: limits.maxAgents,
    max_integrations: limits.maxIntegrations,
    max_runtime_events_per_month: limits.maxRuntimeEventsPerMonth,
    audit_retention_days: limits.auditRetentionDays,
    status: s.status,
    provider: s.provider,
    provider_customer_id: s.providerCustomerId,
    provider_subscription_id: s.providerSubscriptionId,
    price_id: priceRow?.id ?? current?.price_id ?? null,
    billing_interval: priceRow?.billing_interval ?? current?.billing_interval ?? null,
    currency: priceRow?.currency ?? current?.currency ?? null,
    current_period_start: s.periodStart?.toISOString() ?? null,
    current_period_end: s.periodEnd?.toISOString() ?? null,
    cancel_at_period_end: s.cancelAtPeriodEnd ?? (current?.provider_subscription_id === s.providerSubscriptionId ? !!current?.cancel_at_period_end : false),
    cancelled_at: s.cancelledAt?.toISOString() ?? null,
    provider_state_at: s.stateAt.toISOString(),
    renewed_at: s.status === "active" ? new Date().toISOString() : (current?.renewed_at ?? null),
    updated_at: new Date().toISOString(),
  };
  const { error } = current
    ? await supabase.from("subscriptions").update(row).eq("id", current.id).eq("tenant_id", s.tenantId)
    : await supabase.from("subscriptions").insert(row);
  if (error) throw new Error(`subscription update failed: ${error.message}`);

  await writeAudit({
    tenantId: s.tenantId,
    actorType: "integration",
    action: "billing.subscription_synced",
    objectType: "subscription",
    objectId: current?.id ?? s.providerSubscriptionId,
    outcome: "success",
    metadata: { provider: s.provider, event: s.eventType, status: s.status, plan, previousPlan: current?.plan ?? null, previousStatus: current?.status ?? null, cancelAtPeriodEnd: s.cancelAtPeriodEnd },
  });

  const becameBad = (s.status === "past_due" || s.status === "cancelled") && current?.status !== s.status;
  if (becameBad) {
    await alertBillingAdmins(
      s.tenantId,
      s.status === "past_due" ? "Payment overdue" : "Subscription ended",
      s.status === "past_due"
        ? "The latest subscription payment did not go through. Update the payment method to keep your current plan."
        : "Your paid subscription has ended and the organization is now on the Free plan's limits.",
      current?.id ?? null,
    );
  }
  return "applied";
}

async function alertBillingAdmins(tenantId: string, title: string, body: string, referenceId: string | null): Promise<void> {
  const holders = await listPermissionHolders(tenantId, "billing.manage");
  await Promise.all(holders.map((userId) => notify({ tenantId, userId, type: "billing_alert", title, body, referenceType: "subscription", referenceId: referenceId ?? undefined })));
}

async function customerSnapshot(tenantId: string): Promise<Record<string, unknown>> {
  const { data } = await db().from("billing_profiles").select("legal_name, billing_email, country, region, city, postal_code, address_line1, address_line2, tax_id_type, tax_id").eq("tenant_id", tenantId).maybeSingle();
  return data ?? {};
}

type InvoiceUpsert = {
  tenantId: string;
  provider: BillingProvider;
  providerInvoiceId: string;
  providerPaymentId: string | null;
  providerNumber: string | null;
  status: "open" | "paid" | "void" | "uncollectible";
  currency: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  taxBreakdown: TaxLine[];
  periodStart: Date | null;
  periodEnd: Date | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  paidAt: Date | null;
};

const httpsOrNull = (u: unknown) => (typeof u === "string" && u.startsWith("https://") ? u : null);

/** Inserts an invoice once, then only advances its payment state; a paid invoice gets the next sequential number. */
async function upsertInvoice(inv: InvoiceUpsert): Promise<void> {
  const supabase = db();
  const { data: subRow } = await supabase.from("subscriptions").select("id").eq("tenant_id", inv.tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const { data: existing } = await supabase.from("billing_invoices").select().eq("provider", inv.provider).eq("provider_invoice_id", inv.providerInvoiceId).maybeSingle();
  if (existing && existing.tenant_id !== inv.tenantId) throw new Error("invoice belongs to a different tenant");

  let invoiceNumber: string | null = existing?.invoice_number ?? null;
  if (!invoiceNumber && inv.status === "paid") {
    const { data: n, error } = await supabase.rpc("next_invoice_number", { p_at: (inv.paidAt ?? new Date()).toISOString() });
    if (error) throw new Error(`invoice numbering failed: ${error.message}`);
    invoiceNumber = n as string;
  }

  if (!existing) {
    const { error } = await supabase.from("billing_invoices").insert({
      tenant_id: inv.tenantId,
      subscription_id: subRow?.id ?? null,
      provider: inv.provider,
      provider_invoice_id: inv.providerInvoiceId,
      provider_payment_id: inv.providerPaymentId,
      provider_number: inv.providerNumber,
      invoice_number: invoiceNumber,
      status: inv.status,
      currency: inv.currency,
      subtotal: inv.subtotal,
      tax_amount: inv.taxAmount,
      total: inv.total,
      amount_paid: inv.amountPaid,
      tax_breakdown: inv.taxBreakdown,
      customer_snapshot: await customerSnapshot(inv.tenantId),
      period_start: inv.periodStart?.toISOString() ?? null,
      period_end: inv.periodEnd?.toISOString() ?? null,
      hosted_invoice_url: inv.hostedInvoiceUrl,
      invoice_pdf_url: inv.invoicePdfUrl,
      paid_at: inv.paidAt?.toISOString() ?? null,
    });
    if (error && error.code !== "23505") throw new Error(`invoice insert failed: ${error.message}`);
  } else {
    // A refunded invoice keeps its refund status; payment state only moves forward.
    const keepStatus = existing.status === "refunded" || existing.status === "partially_refunded";
    const { error } = await supabase
      .from("billing_invoices")
      .update({
        status: keepStatus ? existing.status : inv.status,
        amount_paid: Math.max(Number(existing.amount_paid), inv.amountPaid),
        provider_payment_id: existing.provider_payment_id ?? inv.providerPaymentId,
        provider_number: existing.provider_number ?? inv.providerNumber,
        invoice_number: invoiceNumber,
        hosted_invoice_url: inv.hostedInvoiceUrl ?? existing.hosted_invoice_url,
        invoice_pdf_url: inv.invoicePdfUrl ?? existing.invoice_pdf_url,
        paid_at: existing.paid_at ?? inv.paidAt?.toISOString() ?? null,
      })
      .eq("id", existing.id)
      .eq("tenant_id", inv.tenantId);
    if (error) throw new Error(`invoice update failed: ${error.message}`);
  }

  if (inv.status === "paid" && existing?.status !== "paid") {
    await writeAudit({
      tenantId: inv.tenantId,
      actorType: "integration",
      action: "billing.invoice_paid",
      objectType: "billing_invoice",
      objectId: inv.providerInvoiceId,
      outcome: "success",
      metadata: { provider: inv.provider, invoiceNumber, currency: inv.currency, total: inv.total },
    });
  }
}

/** Records a (cumulative) refund amount against the invoice paid by `paymentRef`. */
async function applyRefund(provider: BillingProvider, match: { invoiceId?: string | null; paymentId?: string | null }, cumulativeRefunded: number | null, increment: number | null): Promise<string | null> {
  const supabase = db();
  let query = supabase.from("billing_invoices").select().eq("provider", provider);
  if (match.invoiceId) query = query.eq("provider_invoice_id", match.invoiceId);
  else if (match.paymentId) query = query.eq("provider_payment_id", match.paymentId);
  else return null;
  const { data: inv } = await query.maybeSingle();
  if (!inv) return null;
  const refunded = Math.min(Number(inv.amount_paid), cumulativeRefunded ?? Number(inv.amount_refunded) + (increment ?? 0));
  if (refunded <= Number(inv.amount_refunded)) return inv.tenant_id;
  const { error } = await supabase
    .from("billing_invoices")
    .update({ amount_refunded: refunded, status: refunded >= Number(inv.amount_paid) ? "refunded" : "partially_refunded" })
    .eq("id", inv.id)
    .eq("tenant_id", inv.tenant_id);
  if (error) throw new Error(`refund update failed: ${error.message}`);
  await writeAudit({
    tenantId: inv.tenant_id,
    actorType: "integration",
    action: "billing.invoice_refunded",
    objectType: "billing_invoice",
    objectId: inv.id,
    outcome: "success",
    metadata: { provider, amountRefunded: refunded, currency: inv.currency },
  });
  return inv.tenant_id;
}

async function checkoutByReference(provider: BillingProvider, reference: string) {
  const { data } = await db().from("billing_checkouts").select().eq("provider", provider).eq("provider_reference", reference).maybeSingle();
  return data;
}

async function tenantBySubscription(provider: BillingProvider, providerSubscriptionId: string): Promise<string | null> {
  const { data } = await db().from("subscriptions").select("tenant_id").eq("provider", provider).eq("provider_subscription_id", providerSubscriptionId).maybeSingle();
  return (data?.tenant_id as string | undefined) ?? null;
}

async function tenantByCustomer(provider: BillingProvider, customerId: string): Promise<string | null> {
  const column = provider === "stripe" ? "stripe_customer_id" : "razorpay_customer_id";
  const { data } = await db().from("billing_profiles").select("tenant_id").eq(column, customerId).maybeSingle();
  return (data?.tenant_id as string | undefined) ?? null;
}

async function priceIdForProviderPrice(provider: BillingProvider, providerPriceId: string | null | undefined): Promise<string | null> {
  if (!providerPriceId) return null;
  const column = provider === "stripe" ? "stripe_price_id" : "razorpay_plan_id";
  const { data } = await db().from("billing_prices").select("id").eq(column, providerPriceId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

const fromUnix = (s: unknown) => (typeof s === "number" && s > 0 ? new Date(s * 1000) : null);

// ---------------------------------------------------------------- Stripe

function stripeSubscriptionPeriod(sub: any): { start: Date | null; end: Date | null; priceId: string | null } {
  const item = sub?.items?.data?.[0];
  return {
    start: fromUnix(sub?.current_period_start ?? item?.current_period_start),
    end: fromUnix(sub?.current_period_end ?? item?.current_period_end),
    priceId: item?.price?.id ?? null,
  };
}

async function applyStripeSubscription(tenantId: string, sub: any, eventType: string, stateAt: Date, fallbackPriceId: string | null) {
  const period = stripeSubscriptionPeriod(sub);
  const priceId = (await priceIdForProviderPrice("stripe", period.priceId)) ?? fallbackPriceId;
  return applySubscriptionState({
    tenantId,
    provider: "stripe",
    providerSubscriptionId: sub.id,
    providerCustomerId: typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null),
    priceId,
    status: eventType === "customer.subscription.deleted" ? "cancelled" : mapStripeStatus(String(sub.status)),
    periodStart: period.start,
    periodEnd: period.end,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    cancelledAt: fromUnix(sub.canceled_at),
    stateAt,
    eventType,
  });
}

function stripeInvoicePaymentRef(inv: any): string | null {
  const direct = inv.payment_intent ?? inv.charge;
  if (typeof direct === "string") return direct;
  if (direct?.id) return direct.id;
  const p = inv.payments?.data?.[0]?.payment;
  return p?.payment_intent ?? p?.charge ?? null;
}

function stripeInvoiceSubscription(inv: any): string | null {
  const s = inv.subscription ?? inv.parent?.subscription_details?.subscription;
  return typeof s === "string" ? s : (s?.id ?? null);
}

export async function processStripeEvent(event: any): Promise<WebhookOutcome> {
  const intake = await recordIntake({ provider: "stripe", eventId: String(event.id), eventType: String(event.type), createdAt: fromUnix(event.created), payload: event });
  if (intake.duplicate) return { status: "duplicate", retry: false };
  const stateAt = fromUnix(event.created) ?? new Date();
  const obj = event.data?.object ?? {};
  let tenantId: string | null = null;
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const checkout = await checkoutByReference("stripe", String(obj.id));
        if (!checkout) return finish(intake.id, { status: "ignored", retry: false, detail: "checkout not created by WonderID" }, null);
        tenantId = checkout.tenant_id;
        await db().from("billing_checkouts").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", checkout.id).eq("tenant_id", checkout.tenant_id);
        const subId = typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id;
        if (subId) {
          // Read the authoritative current state from Stripe rather than trusting the event alone.
          const sub = await stripe.retrieveSubscription(subId);
          await applyStripeSubscription(checkout.tenant_id, sub, event.type, stateAt, checkout.price_id);
        }
        return finish(intake.id, { status: "processed", retry: false }, tenantId);
      }
      case "checkout.session.expired": {
        const checkout = await checkoutByReference("stripe", String(obj.id));
        if (checkout) await db().from("billing_checkouts").update({ status: "expired" }).eq("id", checkout.id).eq("tenant_id", checkout.tenant_id);
        return finish(intake.id, { status: checkout ? "processed" : "ignored", retry: false }, checkout?.tenant_id ?? null);
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        tenantId = await tenantBySubscription("stripe", String(obj.id));
        let fallbackPrice: string | null = null;
        if (!tenantId && obj.metadata?.wonderid_checkout_id) {
          const { data: checkout } = await db().from("billing_checkouts").select().eq("id", obj.metadata.wonderid_checkout_id).eq("provider", "stripe").maybeSingle();
          const customerTenant = typeof obj.customer === "string" ? await tenantByCustomer("stripe", obj.customer) : null;
          // Both the checkout WonderID recorded and the customer it created must name the same tenant.
          if (checkout && customerTenant === checkout.tenant_id) {
            tenantId = checkout.tenant_id;
            fallbackPrice = checkout.price_id;
          }
        }
        if (!tenantId) return finish(intake.id, { status: "failed", retry: true, detail: "subscription not yet linked to a tenant" }, null);
        const result = await applyStripeSubscription(tenantId, obj, event.type, stateAt, fallbackPrice);
        return finish(intake.id, { status: result === "stale" ? "ignored" : "processed", retry: false, detail: result === "stale" ? "older than the applied state" : undefined }, tenantId);
      }
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
      case "invoice.voided":
      case "invoice.marked_uncollectible": {
        const subId = stripeInvoiceSubscription(obj);
        tenantId = (subId ? await tenantBySubscription("stripe", subId) : null) ?? (typeof obj.customer === "string" ? await tenantByCustomer("stripe", obj.customer) : null);
        if (!tenantId) return finish(intake.id, { status: "failed", retry: true, detail: "invoice not yet linked to a tenant" }, null);
        if (obj.status === "draft") return finish(intake.id, { status: "ignored", retry: false, detail: "draft invoice" }, tenantId);
        const status = obj.status === "paid" ? "paid" : obj.status === "void" ? "void" : obj.status === "uncollectible" ? "uncollectible" : "open";
        const total = Number(obj.total ?? 0);
        const subtotal = Number(obj.subtotal_excluding_tax ?? obj.subtotal ?? total);
        const taxLines: TaxLine[] = (obj.total_tax_amounts ?? obj.total_taxes ?? []).map((t: any) => ({ name: "Tax", rate: 0, amount: Number(t.amount ?? 0) }));
        const taxAmount = Number(obj.tax ?? taxLines.reduce((a, t) => a + t.amount, 0) ?? Math.max(0, total - subtotal));
        await upsertInvoice({
          tenantId,
          provider: "stripe",
          providerInvoiceId: String(obj.id),
          providerPaymentId: stripeInvoicePaymentRef(obj),
          providerNumber: obj.number ?? null,
          status,
          currency: String(obj.currency ?? "usd").toUpperCase(),
          subtotal: Math.max(0, subtotal),
          taxAmount: Math.max(0, taxAmount),
          total: Math.max(0, total),
          amountPaid: Number(obj.amount_paid ?? 0),
          taxBreakdown: taxLines,
          periodStart: fromUnix(obj.period_start),
          periodEnd: fromUnix(obj.period_end),
          hostedInvoiceUrl: httpsOrNull(obj.hosted_invoice_url),
          invoicePdfUrl: httpsOrNull(obj.invoice_pdf),
          paidAt: fromUnix(obj.status_transitions?.paid_at),
        });
        if (event.type === "invoice.payment_failed") {
          await alertBillingAdmins(tenantId, "Payment failed", "A subscription payment failed. Stripe will retry; update the payment method in the billing portal.", null);
        }
        return finish(intake.id, { status: "processed", retry: false }, tenantId);
      }
      case "charge.refunded": {
        const invoiceId = typeof obj.invoice === "string" ? obj.invoice : null;
        const paymentId = typeof obj.payment_intent === "string" ? obj.payment_intent : String(obj.id);
        tenantId = await applyRefund("stripe", { invoiceId, paymentId: invoiceId ? null : paymentId }, Number(obj.amount_refunded ?? 0), null);
        if (!tenantId && invoiceId) tenantId = await applyRefund("stripe", { paymentId }, Number(obj.amount_refunded ?? 0), null);
        return finish(intake.id, { status: tenantId ? "processed" : "ignored", retry: false, detail: tenantId ? undefined : "no matching invoice" }, tenantId);
      }
      default:
        return finish(intake.id, { status: "ignored", retry: false, detail: "event type not used" }, null);
    }
  } catch (err) {
    return finish(intake.id, { status: "failed", retry: true, detail: safeErrorMessage(err) }, tenantId);
  }
}

// ---------------------------------------------------------------- Razorpay

export async function processRazorpayEvent(eventId: string, event: any): Promise<WebhookOutcome> {
  const intake = await recordIntake({ provider: "razorpay", eventId, eventType: String(event.event ?? "unknown"), createdAt: fromUnix(event.created_at), payload: event });
  if (intake.duplicate) return { status: "duplicate", retry: false };
  const stateAt = fromUnix(event.created_at) ?? new Date();
  const sub = event.payload?.subscription?.entity;
  const payment = event.payload?.payment?.entity;
  const refund = event.payload?.refund?.entity;
  let tenantId: string | null = null;
  try {
    const type = String(event.event);
    if (type.startsWith("subscription.") && sub?.id) {
      tenantId = await tenantBySubscription("razorpay", String(sub.id));
      let fallbackPrice: string | null = null;
      if (!tenantId) {
        const checkout = await checkoutByReference("razorpay", String(sub.id));
        if (checkout) {
          tenantId = checkout.tenant_id;
          fallbackPrice = checkout.price_id;
          if (type === "subscription.activated" || type === "subscription.charged" || type === "subscription.authenticated") {
            await db().from("billing_checkouts").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", checkout.id).eq("tenant_id", checkout.tenant_id);
          }
        }
      }
      if (!tenantId) return finish(intake.id, { status: "ignored", retry: false, detail: "subscription not created by WonderID" }, null);
      const priceId = (await priceIdForProviderPrice("razorpay", sub.plan_id)) ?? fallbackPrice;
      const result = await applySubscriptionState({
        tenantId,
        provider: "razorpay",
        providerSubscriptionId: String(sub.id),
        providerCustomerId: sub.customer_id ?? null,
        priceId,
        status: mapRazorpayStatus(String(sub.status)),
        periodStart: fromUnix(sub.current_start),
        periodEnd: fromUnix(sub.current_end),
        cancelAtPeriodEnd: type === "subscription.cancelled" || type === "subscription.completed" ? false : null,
        cancelledAt: type === "subscription.cancelled" ? stateAt : null,
        stateAt,
        eventType: type,
      });

      if (type === "subscription.charged" && payment?.id) {
        const { data: priceRow } = priceId ? await db().from("billing_prices").select("tax_behavior").eq("id", priceId).maybeSingle() : { data: null };
        const { data: profile } = await db().from("billing_profiles").select("country, region, tax_id_type, tax_id").eq("tenant_id", tenantId).maybeSingle();
        const gst = computeGst(Number(payment.amount), (priceRow?.tax_behavior as "inclusive" | "exclusive" | undefined) ?? "inclusive", supplierGst().stateCode, {
          country: profile?.country ?? "IN",
          stateCode: profile ? customerStateCode({ country: profile.country, region: profile.region, taxIdType: profile.tax_id_type, taxId: profile.tax_id }) : null,
        });
        await upsertInvoice({
          tenantId,
          provider: "razorpay",
          providerInvoiceId: String(payment.invoice_id ?? payment.id),
          providerPaymentId: String(payment.id),
          providerNumber: null,
          status: "paid",
          currency: String(payment.currency ?? "INR").toUpperCase(),
          // The charged amount is what the customer paid; with inclusive prices the GST is inside it.
          subtotal: gst.subtotal,
          taxAmount: gst.tax,
          total: Number(payment.amount),
          amountPaid: Number(payment.amount),
          taxBreakdown: gst.lines,
          periodStart: fromUnix(sub.current_start),
          periodEnd: fromUnix(sub.current_end),
          hostedInvoiceUrl: null,
          invoicePdfUrl: null,
          paidAt: fromUnix(payment.created_at) ?? stateAt,
        });
      }
      return finish(intake.id, { status: result === "stale" ? "ignored" : "processed", retry: false }, tenantId);
    }
    if ((type === "refund.processed" || type === "refund.created") && refund?.payment_id) {
      tenantId = await applyRefund("razorpay", { paymentId: String(refund.payment_id) }, null, type === "refund.processed" ? Number(refund.amount ?? 0) : 0);
      return finish(intake.id, { status: tenantId ? "processed" : "ignored", retry: false }, tenantId);
    }
    if (type === "payment.failed" && payment?.customer_id) {
      tenantId = await tenantByCustomer("razorpay", String(payment.customer_id));
      if (tenantId) await alertBillingAdmins(tenantId, "Payment failed", "A subscription payment failed. Razorpay will retry; check the payment method on the mandate.", null);
      return finish(intake.id, { status: tenantId ? "processed" : "ignored", retry: false }, tenantId);
    }
    return finish(intake.id, { status: "ignored", retry: false, detail: "event type not used" }, null);
  } catch (err) {
    return finish(intake.id, { status: "failed", retry: true, detail: safeErrorMessage(err) }, tenantId);
  }
}
