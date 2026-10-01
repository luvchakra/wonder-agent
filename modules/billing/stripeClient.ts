import "server-only";

import { ApiError } from "@/lib/shared/types/foundation";
import { stripeConfig } from "./config";
import { providerFetch } from "./http";

/**
 * A minimal Stripe REST client (no SDK dependency, per CLAUDE.md §3: no new
 * framework for what a dozen fetch calls do). Covers exactly what billing
 * needs: customers, prices, Checkout Sessions, the Billing Portal,
 * subscription cancel/resume, and refunds. API version pinned so a Stripe
 * default-version change cannot silently alter payload shapes; create the
 * webhook endpoint with the same version (docs/security/BILLING.md). The
 * webhook handlers still read both the pre- and post-2025 shapes.
 */

const API = "https://api.stripe.com/v1";
const API_VERSION = "2024-06-20";

type Params = Record<string, unknown>;

/** Stripe's form encoding: nested objects as a[b]=c, arrays as a[0]=x. */
export function formEncode(params: Params, prefix = ""): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === "object") parts.push(formEncode(v as Params, `${name}[${i}]`));
        else parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(v))}`);
      });
    } else if (typeof value === "object") {
      const nested = formEncode(value as Params, name);
      if (nested) parts.push(nested);
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

function requireConfig() {
  const cfg = stripeConfig();
  if (!cfg) throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", "Stripe is not configured for this deployment");
  return cfg;
}

async function stripe<T>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
  const cfg = requireConfig();
  const encoded = formEncode(params);
  const url = method === "GET" && encoded ? `${API}${path}?${encoded}` : `${API}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.secretKey}`,
    "Stripe-Version": API_VERSION,
  };
  if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return providerFetch<T>({ url, method, headers, body: method === "GET" ? undefined : encoded, retryable: method === "GET" || !!idempotencyKey, provider: "stripe" });
}

export type StripeCustomer = { id: string };
export type StripePrice = { id: string };
export type StripeCheckoutSession = { id: string; url: string | null };
export type StripePortalSession = { url: string };
export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  items: { data: { current_period_start?: number; current_period_end?: number; price: { id: string } }[] };
  current_period_start?: number;
  current_period_end?: number;
  metadata?: Record<string, string>;
};
export type StripeRefund = { id: string; status: string };

export function createCustomer(input: { tenantId: string; name: string; email: string; country: string; taxId?: { type: string; value: string } | null }, idempotencyKey: string) {
  return stripe<StripeCustomer>(
    "POST",
    "/customers",
    {
      name: input.name,
      email: input.email,
      address: { country: input.country },
      metadata: { wonderid_tenant_id: input.tenantId },
      ...(input.taxId ? { tax_id_data: [{ type: input.taxId.type, value: input.taxId.value }] } : {}),
    },
    idempotencyKey,
  );
}

export function updateCustomer(customerId: string, input: { name: string; email: string; country: string }) {
  return stripe<StripeCustomer>("POST", `/customers/${encodeURIComponent(customerId)}`, { name: input.name, email: input.email, address: { country: input.country } });
}

export function createPrice(input: { priceId: string; plan: string; interval: string; currency: string; unitAmount: number; taxBehavior: string }, idempotencyKey: string) {
  return stripe<StripePrice>(
    "POST",
    "/prices",
    {
      currency: input.currency.toLowerCase(),
      unit_amount: input.unitAmount,
      recurring: { interval: input.interval },
      tax_behavior: input.taxBehavior,
      product_data: { name: `WonderID ${input.plan === "pro" ? "Pro" : "Max"}` },
      metadata: { wonderid_price_id: input.priceId },
    },
    idempotencyKey,
  );
}

export function createCheckoutSession(
  input: { customerId: string; stripePriceId: string; tenantId: string; checkoutId: string; successUrl: string; cancelUrl: string; automaticTax: boolean },
  idempotencyKey: string,
) {
  return stripe<StripeCheckoutSession>(
    "POST",
    "/checkout/sessions",
    {
      mode: "subscription",
      customer: input.customerId,
      line_items: [{ price: input.stripePriceId, quantity: 1 }],
      client_reference_id: input.checkoutId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: "false",
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      tax_id_collection: { enabled: "true" },
      ...(input.automaticTax ? { automatic_tax: { enabled: "true" } } : {}),
      subscription_data: { metadata: { wonderid_tenant_id: input.tenantId, wonderid_checkout_id: input.checkoutId } },
      metadata: { wonderid_tenant_id: input.tenantId, wonderid_checkout_id: input.checkoutId },
    },
    idempotencyKey,
  );
}

export function createPortalSession(customerId: string, returnUrl: string) {
  return stripe<StripePortalSession>("POST", "/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
}

export function retrieveSubscription(subscriptionId: string) {
  return stripe<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export function setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean, idempotencyKey: string) {
  return stripe<StripeSubscription>("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: String(cancel) }, idempotencyKey);
}

export function cancelImmediately(subscriptionId: string) {
  return stripe<StripeSubscription>("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export function createRefund(input: { paymentIntentOrCharge: string; amount: number; reason: string }, idempotencyKey: string) {
  const isCharge = input.paymentIntentOrCharge.startsWith("ch_");
  return stripe<StripeRefund>(
    "POST",
    "/refunds",
    { ...(isCharge ? { charge: input.paymentIntentOrCharge } : { payment_intent: input.paymentIntentOrCharge }), amount: input.amount, reason: "requested_by_customer", metadata: { wonderid_reason: input.reason.slice(0, 450) } },
    idempotencyKey,
  );
}
