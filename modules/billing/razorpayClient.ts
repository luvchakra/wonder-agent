import "server-only";

import { ApiError } from "@/lib/shared/types/foundation";
import { razorpayConfig } from "./config";
import { providerFetch } from "./http";

/**
 * A minimal Razorpay REST client (no SDK). Covers customers, plans,
 * subscriptions (the hosted authorisation link — `short_url` — so card and
 * UPI details are entered on Razorpay, never here), cancellation and
 * refunds. Basic auth with the key id and secret, server-side only.
 */

const API = "https://api.razorpay.com/v1";

function requireConfig() {
  const cfg = razorpayConfig();
  if (!cfg) throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", "Razorpay is not configured for this deployment");
  return cfg;
}

async function razorpay<T>(method: "GET" | "POST" | "PATCH", path: string, body?: Record<string, unknown>, idempotent = false): Promise<T> {
  const cfg = requireConfig();
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
  return providerFetch<T>({
    url: `${API}${path}`,
    method,
    headers: { Authorization: `Basic ${auth}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    retryable: method === "GET" || idempotent,
    provider: "razorpay",
  });
}

export type RazorpayCustomer = { id: string };
export type RazorpayPlan = { id: string };
export type RazorpaySubscription = {
  id: string;
  status: string;
  plan_id: string;
  customer_id: string | null;
  current_start: number | null;
  current_end: number | null;
  short_url: string | null;
  notes?: Record<string, string>;
};
export type RazorpayRefund = { id: string; status: string };

/** `fail_existing: 0` returns the existing customer for the same email instead of failing, so a retry is idempotent. */
export function createCustomer(input: { tenantId: string; name: string; email: string; gstin: string | null }) {
  return razorpay<RazorpayCustomer>(
    "POST",
    "/customers",
    { name: input.name.slice(0, 50), email: input.email, fail_existing: "0", ...(input.gstin ? { gstin: input.gstin } : {}), notes: { wonderid_tenant_id: input.tenantId } },
    true,
  );
}

export function createPlan(input: { priceId: string; plan: string; interval: "month" | "year"; unitAmount: number; currency: string }) {
  return razorpay<RazorpayPlan>("POST", "/plans", {
    period: input.interval === "month" ? "monthly" : "yearly",
    interval: 1,
    item: { name: `WonderID ${input.plan === "pro" ? "Pro" : "Max"}`, amount: input.unitAmount, currency: input.currency },
    notes: { wonderid_price_id: input.priceId },
  });
}

/** total_count is required by Razorpay; 10 years of cycles, renewed by a new subscription if ever reached. */
export function createSubscription(input: { planId: string; customerId: string; interval: "month" | "year"; tenantId: string; checkoutId: string }) {
  return razorpay<RazorpaySubscription>("POST", "/subscriptions", {
    plan_id: input.planId,
    customer_id: input.customerId,
    customer_notify: 1,
    quantity: 1,
    total_count: input.interval === "month" ? 120 : 10,
    notes: { wonderid_tenant_id: input.tenantId, wonderid_checkout_id: input.checkoutId },
  });
}

export function fetchSubscription(subscriptionId: string) {
  return razorpay<RazorpaySubscription>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export function cancelSubscription(subscriptionId: string, atCycleEnd: boolean) {
  return razorpay<RazorpaySubscription>("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
}

/** Razorpay de-duplicates refunds on the receipt within a payment. */
export function createRefund(input: { paymentId: string; amount: number; receipt: string; reason: string }) {
  return razorpay<RazorpayRefund>(
    "POST",
    `/payments/${encodeURIComponent(input.paymentId)}/refund`,
    { amount: input.amount, speed: "normal", receipt: input.receipt.slice(0, 40), notes: { wonderid_reason: input.reason.slice(0, 250) } },
    true,
  );
}
