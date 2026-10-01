// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hmacSha256Hex, verifyRazorpaySubscriptionPayment, verifyRazorpayWebhookSignature, verifyStripeSignature } from "./signatures";
import { formEncode } from "./stripeClient";

const SECRET = "whsec_test_secret";
const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });

describe("verifyStripeSignature — PLATFORM-P1-04", () => {
  const now = 1_790_000_000;
  const sign = (t: number, payload = body, secret = SECRET) => `t=${t},v1=${hmacSha256Hex(secret, `${t}.${payload}`)}`;

  it("accepts a correctly signed, fresh event", () => {
    expect(verifyStripeSignature(body, sign(now), SECRET, now)).toEqual({ ok: true, timestamp: now });
  });
  it("accepts when any one of several v1 signatures matches (secret rotation)", () => {
    const header = `t=${now},v1=${"0".repeat(64)},v1=${hmacSha256Hex(SECRET, `${now}.${body}`)}`;
    expect(verifyStripeSignature(body, header, SECRET, now).ok).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyStripeSignature(body.replace("invoice.paid", "invoice.voided"), sign(now), SECRET, now)).toEqual({ ok: false, reason: "no_matching_signature" });
  });
  it("rejects the wrong secret", () => {
    expect(verifyStripeSignature(body, sign(now, body, "whsec_other"), SECRET, now).ok).toBe(false);
  });
  it("rejects a replay outside the five-minute tolerance", () => {
    expect(verifyStripeSignature(body, sign(now - 301), SECRET, now)).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });
  it("rejects a missing or malformed header", () => {
    expect(verifyStripeSignature(body, null, SECRET, now)).toEqual({ ok: false, reason: "missing_header" });
    expect(verifyStripeSignature(body, "v1=abc", SECRET, now)).toEqual({ ok: false, reason: "malformed_header" });
    expect(verifyStripeSignature(body, `t=${now},v1=not-hex`, SECRET, now).ok).toBe(false);
  });
});

describe("Razorpay signatures", () => {
  it("verifies a webhook body signature and rejects tampering", () => {
    const sig = hmacSha256Hex("rzp_webhook_secret", body);
    expect(verifyRazorpayWebhookSignature(body, sig, "rzp_webhook_secret")).toBe(true);
    expect(verifyRazorpayWebhookSignature(`${body} `, sig, "rzp_webhook_secret")).toBe(false);
    expect(verifyRazorpayWebhookSignature(body, null, "rzp_webhook_secret")).toBe(false);
    expect(verifyRazorpayWebhookSignature(body, sig.slice(0, 10), "rzp_webhook_secret")).toBe(false);
  });
  it("verifies the subscription checkout callback signature", () => {
    const sig = hmacSha256Hex("key_secret", "pay_123|sub_456");
    expect(verifyRazorpaySubscriptionPayment("pay_123", "sub_456", sig, "key_secret")).toBe(true);
    expect(verifyRazorpaySubscriptionPayment("pay_123", "sub_999", sig, "key_secret")).toBe(false);
  });
});

describe("Stripe formEncode", () => {
  it("encodes nested objects and arrays in Stripe's bracket syntax", () => {
    const encoded = formEncode({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], metadata: { a: "x y" }, skip: undefined });
    expect(decodeURIComponent(encoded)).toBe("mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[a]=x y");
  });
});
