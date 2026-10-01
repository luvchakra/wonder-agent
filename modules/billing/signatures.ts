import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * PLATFORM-P1-04 — webhook and payment signature verification for Stripe
 * and Razorpay (CLAUDE.md §17.6, §17.7: verify the source; non-negotiable
 * #19: an unverified payload is never acted on). Pure functions, no I/O.
 */

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

export type StripeSignatureResult = { ok: true; timestamp: number } | { ok: false; reason: "missing_header" | "malformed_header" | "timestamp_out_of_tolerance" | "no_matching_signature" };

/**
 * Stripe's scheme: header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]`,
 * where v1 = HMAC-SHA256(endpoint secret, `${t}.${rawBody}`). Any v1 may
 * match (secret rotation sends two). The timestamp must be within
 * `toleranceSeconds` of now, which defeats replay of a captured event.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): StripeSignatureResult {
  if (!header) return { ok: false, reason: "missing_header" };
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((x) => x?.trim());
    if (k === "t" && v && /^\d+$/.test(v)) timestamp = Number(v);
    else if (k === "v1" && v) signatures.push(v);
  }
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: "malformed_header" };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: "timestamp_out_of_tolerance" };
  const expected = hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return signatures.some((s) => safeEqualHex(s, expected)) ? { ok: true, timestamp } : { ok: false, reason: "no_matching_signature" };
}

/**
 * Razorpay webhooks: header `X-Razorpay-Signature` = hex
 * HMAC-SHA256(webhook secret, rawBody). Razorpay sends no timestamp in the
 * signature, so replay protection is the idempotency on the event id
 * (`x-razorpay-event-id`) in billing_webhook_events.
 */
export function verifyRazorpayWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  return safeEqualHex(header.trim(), hmacSha256Hex(secret, rawBody));
}

/**
 * Razorpay Checkout's client callback for a subscription:
 * signature = HMAC-SHA256(key secret, `${payment_id}|${subscription_id}`).
 */
export function verifyRazorpaySubscriptionPayment(paymentId: string, subscriptionId: string, signature: string, keySecret: string): boolean {
  return safeEqualHex(signature, hmacSha256Hex(keySecret, `${paymentId}|${subscriptionId}`));
}
