import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { BillingInvoice, BillingPrice, BillingProfile, BillingProvider, Subscription } from "@/lib/shared/types/platform";
import { getSubscription, getUsageSummary, type UsageCheck } from "@/modules/platform-admin/service";
import { appBaseUrl, configuredProviders, stripeConfig } from "./config";
import { toInvoice, toPrice, toProfile } from "./mappers";
import { chooseProvider, validateBillingProfile } from "./rules";
import * as stripe from "./stripeClient";
import * as razorpay from "./razorpayClient";

/**
 * PLATFORM-P1-04 — the customer side of billing: the subscription and
 * usage overview, the billing profile, checkout, the Stripe portal,
 * cancellation, and invoices. Every function takes the server-resolved
 * tenant (§14); callers have already passed requirePermission() for
 * billing.view / billing.manage. Reads use the member's own client, so
 * RLS (has_tenant_permission(), 0101) enforces the same gate again;
 * writes use the service role, filtered to that tenant, and are audited.
 *
 * Payment is always collected on the provider's hosted page; nothing here
 * ever sees a card or bank detail (PCI DSS SAQ-A).
 */

export type BillingOverview = {
  subscription: Subscription | null;
  profile: BillingProfile | null;
  prices: BillingPrice[];
  invoices: BillingInvoice[];
  invoiceCount: number;
  usage: UsageCheck[];
  providers: { stripe: boolean; razorpay: boolean };
  canOpenPortal: boolean;
};

export async function listPrices(): Promise<BillingPrice[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("billing_prices").select().eq("active", true).order("plan").order("billing_interval").order("currency");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPrice);
}

/**
 * The public price list, for the signed-out landing page. billing_prices is
 * WonderID's own global catalogue — no customer data — but its RLS policy
 * admits signed-in users only, so this reads it with the service role and
 * returns only the public columns of active prices: never the payment
 * providers' price or plan ids. Read-only, no tenant involved.
 */
export async function listPublicPrices(): Promise<BillingPrice[]> {
  const { data, error } = await supabaseServiceRole()
    .from("billing_prices")
    .select("id, plan, billing_interval, currency, unit_amount, tax_behavior, active")
    .eq("active", true)
    .order("plan")
    .order("billing_interval")
    .order("currency");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPrice);
}

export async function getBillingProfile(tenantId: string): Promise<BillingProfile | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("billing_profiles").select().eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toProfile(data) : null;
}

export async function listInvoices(tenantId: string, opts: { limit?: number; offset?: number } = {}): Promise<{ invoices: BillingInvoice[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const supabase = await supabaseServer();
  const { data, error, count } = await supabase
    .from("billing_invoices")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("issued_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return { invoices: (data ?? []).map(toInvoice), total: count ?? 0 };
}

export async function getInvoice(tenantId: string, invoiceId: string): Promise<BillingInvoice | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("billing_invoices").select().eq("tenant_id", tenantId).eq("id", invoiceId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toInvoice(data) : null;
}

export async function getBillingOverview(tenantId: string): Promise<BillingOverview> {
  const [subscription, profile, prices, page, usage, stripeCustomer] = await Promise.all([
    getSubscription(tenantId),
    getBillingProfile(tenantId),
    listPrices(),
    listInvoices(tenantId, { limit: 10 }),
    getUsageSummary(tenantId),
    stripeCustomerId(tenantId),
  ]);
  return {
    subscription,
    profile,
    prices,
    invoices: page.invoices,
    invoiceCount: page.total,
    usage,
    providers: configuredProviders(),
    canOpenPortal: !!stripeCustomer && configuredProviders().stripe,
  };
}

async function stripeCustomerId(tenantId: string): Promise<string | null> {
  const { data } = await supabaseServiceRole().from("billing_profiles").select("stripe_customer_id").eq("tenant_id", tenantId).maybeSingle();
  return (data?.stripe_customer_id as string | null) ?? null;
}

export async function saveBillingProfile(
  tenantId: string,
  actorId: string,
  raw: Record<string, unknown>,
): Promise<{ ok: true; profile: BillingProfile } | { ok: false; errors: Record<string, string> }> {
  const parsed = validateBillingProfile(raw);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const supabase = supabaseServiceRole();
  const { data: previous } = await supabase.from("billing_profiles").select("country, stripe_customer_id, razorpay_customer_id").eq("tenant_id", tenantId).maybeSingle();
  const { data, error } = await supabase
    .from("billing_profiles")
    .upsert(
      {
        tenant_id: tenantId,
        legal_name: v.legalName,
        billing_email: v.billingEmail,
        country: v.country,
        region: v.region,
        city: v.city,
        postal_code: v.postalCode,
        address_line1: v.addressLine1,
        address_line2: v.addressLine2,
        tax_id_type: v.taxIdType,
        tax_id: v.taxId,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    )
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "SAVE_FAILED", error?.message ?? "Failed to save the billing profile");

  // Keep the provider's customer record in step (best effort: the provider
  // also collects the address on its hosted page). A failure is reported
  // in the audit record, never hidden.
  let providerSync: "skipped" | "synced" | "failed" = "skipped";
  if (previous?.stripe_customer_id && stripeConfig()) {
    try {
      await stripe.updateCustomer(previous.stripe_customer_id, { name: v.legalName, email: v.billingEmail, country: v.country });
      providerSync = "synced";
    } catch {
      providerSync = "failed";
    }
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "billing.profile_updated",
    objectType: "billing_profile",
    objectId: tenantId,
    outcome: "success",
    metadata: { country: v.country, taxIdType: v.taxIdType, countryChanged: previous ? previous.country !== v.country : null, providerSync },
  });
  return { ok: true, profile: toProfile(data) };
}

/** How long an open checkout blocks another one for the same organization. */
const RECENT_CHECKOUT_MS = 10 * 60 * 1000;

/** A paid subscription the provider still manages blocks a second checkout. */
function hasLiveProviderSubscription(sub: Subscription | null): boolean {
  return !!sub && sub.provider !== undefined && sub.provider !== "manual" && sub.status !== "cancelled";
}

export async function startCheckout(tenantId: string, actorId: string, priceId: string, requestOrigin: string): Promise<{ url: string; provider: BillingProvider }> {
  const supabase = supabaseServiceRole();
  const [{ data: priceRow, error: priceError }, { data: profileRow }, subscription] = await Promise.all([
    supabase.from("billing_prices").select().eq("id", priceId).eq("active", true).maybeSingle(),
    supabase.from("billing_profiles").select().eq("tenant_id", tenantId).maybeSingle(),
    getSubscription(tenantId),
  ]);
  if (priceError) throw new ApiError(500, "QUERY_FAILED", priceError.message);
  if (!priceRow) throw new ApiError(404, "PRICE_NOT_FOUND", "That plan is not available");
  if (!profileRow) throw new ApiError(409, "BILLING_PROFILE_REQUIRED", "Add the billing details to invoice before choosing a plan");
  if (hasLiveProviderSubscription(subscription)) {
    throw new ApiError(409, "SUBSCRIPTION_EXISTS", "This organization already has a paid subscription. Change or cancel it first.");
  }
  // A checkout started moments ago may still be completing: a second one
  // could open a second paid subscription (most likely a double click).
  const { data: recentOpen } = await supabase
    .from("billing_checkouts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .gte("created_at", new Date(Date.now() - RECENT_CHECKOUT_MS).toISOString())
    .limit(1);
  if (recentOpen?.length) {
    throw new ApiError(409, "CHECKOUT_IN_PROGRESS", "A checkout was started a few minutes ago. Finish it in the payment window, or try again in 10 minutes.");
  }

  const price = toPrice(priceRow);
  const provider = chooseProvider(price.currency, configuredProviders());
  if (!provider) throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", `Payments in ${price.currency} are not available on this deployment`);

  const base = appBaseUrl(requestOrigin);
  const checkoutId = randomUUID();
  let url: string;
  let providerReference: string;

  if (provider === "stripe") {
    let customerId = profileRow.stripe_customer_id as string | null;
    if (!customerId) {
      const taxId = profileRow.tax_id_type && profileRow.tax_id_type !== "other" ? { type: profileRow.tax_id_type as string, value: profileRow.tax_id as string } : null;
      const customer = await stripe.createCustomer({ tenantId, name: profileRow.legal_name, email: profileRow.billing_email, country: profileRow.country, taxId }, `wid-customer-${tenantId}`);
      customerId = customer.id;
      await supabase.from("billing_profiles").update({ stripe_customer_id: customerId }).eq("tenant_id", tenantId);
    }
    let stripePriceId = priceRow.stripe_price_id as string | null;
    if (!stripePriceId) {
      const created = await stripe.createPrice(
        { priceId: price.id, plan: price.plan, interval: price.interval, currency: price.currency, unitAmount: price.unitAmount, taxBehavior: price.taxBehavior },
        `wid-price-${price.id}-${price.unitAmount}`,
      );
      stripePriceId = created.id;
      await supabase.from("billing_prices").update({ stripe_price_id: stripePriceId }).eq("id", price.id).is("stripe_price_id", null);
    }
    const session = await stripe.createCheckoutSession(
      {
        customerId,
        stripePriceId,
        tenantId,
        checkoutId,
        successUrl: `${base}/settings/billing?checkout=success`,
        cancelUrl: `${base}/settings/billing?checkout=cancelled`,
        automaticTax: stripeConfig()?.automaticTax ?? false,
      },
      `wid-checkout-${checkoutId}`,
    );
    if (!session.url) throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Stripe did not return a checkout page");
    url = session.url;
    providerReference = session.id;
  } else {
    let customerId = profileRow.razorpay_customer_id as string | null;
    if (!customerId) {
      const customer = await razorpay.createCustomer({ tenantId, name: profileRow.legal_name, email: profileRow.billing_email, gstin: profileRow.tax_id_type === "in_gst" ? profileRow.tax_id : null });
      customerId = customer.id;
      await supabase.from("billing_profiles").update({ razorpay_customer_id: customerId }).eq("tenant_id", tenantId);
    }
    let planId = priceRow.razorpay_plan_id as string | null;
    if (!planId) {
      const plan = await razorpay.createPlan({ priceId: price.id, plan: price.plan, interval: price.interval, unitAmount: price.unitAmount, currency: price.currency });
      planId = plan.id;
      await supabase.from("billing_prices").update({ razorpay_plan_id: planId }).eq("id", price.id).is("razorpay_plan_id", null);
    }
    const sub = await razorpay.createSubscription({ planId, customerId, interval: price.interval, tenantId, checkoutId });
    if (!sub.short_url) throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Razorpay did not return an authorisation link");
    url = sub.short_url;
    providerReference = sub.id;
  }

  const { error: checkoutError } = await supabase.from("billing_checkouts").insert({
    id: checkoutId,
    tenant_id: tenantId,
    provider,
    price_id: price.id,
    provider_reference: providerReference,
    created_by: actorId,
  });
  if (checkoutError) throw new ApiError(500, "CREATE_FAILED", checkoutError.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "billing.checkout_started",
    objectType: "billing_checkout",
    objectId: checkoutId,
    outcome: "success",
    metadata: { provider, priceId: price.id, plan: price.plan, currency: price.currency, interval: price.interval },
  });
  return { url, provider };
}

export async function openBillingPortal(tenantId: string, actorId: string, requestOrigin: string): Promise<string> {
  const customerId = await stripeCustomerId(tenantId);
  if (!customerId) throw new ApiError(409, "NO_STRIPE_CUSTOMER", "There is no Stripe billing account for this organization yet");
  const session = await stripe.createPortalSession(customerId, `${appBaseUrl(requestOrigin)}/settings/billing`);
  await writeAudit({ tenantId, actorId, actorType: "user", action: "billing.portal_opened", objectType: "billing_profile", objectId: tenantId, outcome: "success" });
  return session.url;
}

type ProviderSubscription = { id: string; provider: BillingProvider; providerSubscriptionId: string };

async function requireProviderSubscription(tenantId: string): Promise<ProviderSubscription> {
  const { data, error } = await supabaseServiceRole()
    .from("subscriptions")
    .select("id, status, provider, provider_subscription_id")
    .eq("tenant_id", tenantId)
    .neq("provider", "manual")
    .not("provider_subscription_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.status === "cancelled") throw new ApiError(409, "NO_PAID_SUBSCRIPTION", "There is no active paid subscription to change");
  return { id: data.id, provider: data.provider, providerSubscriptionId: data.provider_subscription_id };
}

/**
 * Cancel at the end of the paid period (never mid-period by a customer:
 * an immediate cancellation with refund is a platform adjustment under
 * four-eyes control). The local flag changes only after the provider
 * accepted the change; its webhook then confirms it.
 */
export async function cancelSubscriptionAtPeriodEnd(tenantId: string, actorId: string): Promise<void> {
  const sub = await requireProviderSubscription(tenantId);
  if (sub.provider === "stripe") await stripe.setCancelAtPeriodEnd(sub.providerSubscriptionId, true, `wid-cancel-${sub.providerSubscriptionId}`);
  else await razorpay.cancelSubscription(sub.providerSubscriptionId, true);
  await supabaseServiceRole().from("subscriptions").update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq("id", sub.id).eq("tenant_id", tenantId);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "billing.subscription_cancel_requested",
    objectType: "subscription",
    objectId: sub.id,
    outcome: "success",
    metadata: { provider: sub.provider, atPeriodEnd: true },
  });
}

/** Undo a scheduled cancellation (Stripe only — Razorpay cannot reverse one; a new checkout is needed after it ends). */
export async function resumeSubscription(tenantId: string, actorId: string): Promise<void> {
  const sub = await requireProviderSubscription(tenantId);
  if (sub.provider !== "stripe") throw new ApiError(409, "NOT_SUPPORTED", "Razorpay cannot undo a scheduled cancellation; choose a plan again once it ends");
  await stripe.setCancelAtPeriodEnd(sub.providerSubscriptionId, false, `wid-resume-${sub.providerSubscriptionId}-${Date.now()}`);
  await supabaseServiceRole().from("subscriptions").update({ cancel_at_period_end: false, updated_at: new Date().toISOString() }).eq("id", sub.id).eq("tenant_id", tenantId);
  await writeAudit({ tenantId, actorId, actorType: "user", action: "billing.subscription_resumed", objectType: "subscription", objectId: sub.id, outcome: "success", metadata: { provider: sub.provider } });
}
