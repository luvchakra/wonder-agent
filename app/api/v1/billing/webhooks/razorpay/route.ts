import { NextResponse } from "next/server";
import { razorpayConfig } from "@/modules/billing/config";
import { hmacSha256Hex, verifyRazorpayWebhookSignature } from "@/modules/billing/signatures";
import { processRazorpayEvent } from "@/modules/billing/webhooks";

/**
 * PLATFORM-P1-04 — Razorpay webhook endpoint. No session: each delivery is
 * authenticated by X-Razorpay-Signature over the raw body. Replay and
 * redelivery are absorbed by the event id (x-razorpay-event-id), which is
 * the idempotency key in billing_webhook_events.
 */
const MAX_BODY_BYTES = 512 * 1024;

export async function POST(request: Request) {
  const cfg = razorpayConfig();
  if (!cfg?.webhookSecret) return NextResponse.json({ ok: false, error: { code: "PROVIDER_NOT_CONFIGURED" } }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE" } }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE" } }, { status: 413 });

  if (!verifyRazorpayWebhookSignature(raw, request.headers.get("x-razorpay-signature"), cfg.webhookSecret)) {
    console.warn("razorpay webhook refused", { reason: "invalid_signature" });
    return NextResponse.json({ ok: false, error: { code: "INVALID_SIGNATURE" } }, { status: 400 });
  }
  let event: { event?: unknown };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_JSON" } }, { status: 400 });
  }
  if (typeof event.event !== "string") return NextResponse.json({ ok: false, error: { code: "INVALID_EVENT" } }, { status: 400 });
  // Older Razorpay deliveries may lack the event-id header; a body hash is a stable substitute.
  const eventId = request.headers.get("x-razorpay-event-id") ?? `body-${hmacSha256Hex("razorpay-event", raw).slice(0, 40)}`;

  const outcome = await processRazorpayEvent(eventId.slice(0, 120), event);
  return NextResponse.json({ ok: !outcome.retry, data: { status: outcome.status } }, { status: outcome.retry ? 500 : 200 });
}
