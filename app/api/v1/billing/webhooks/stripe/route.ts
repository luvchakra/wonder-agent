import { NextResponse } from "next/server";
import { stripeConfig } from "@/modules/billing/config";
import { verifyStripeSignature } from "@/modules/billing/signatures";
import { processStripeEvent } from "@/modules/billing/webhooks";

/**
 * PLATFORM-P1-04 — Stripe webhook endpoint. No session: Stripe authenticates
 * each delivery with the endpoint secret (Stripe-Signature, 5-minute
 * replay tolerance). An unsigned, mis-signed or oversized body is refused
 * before anything is parsed or stored (§17.6, non-negotiable #19).
 */
const MAX_BODY_BYTES = 512 * 1024;

export async function POST(request: Request) {
  const cfg = stripeConfig();
  if (!cfg?.webhookSecret) return NextResponse.json({ ok: false, error: { code: "PROVIDER_NOT_CONFIGURED" } }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE" } }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE" } }, { status: 413 });

  const verified = verifyStripeSignature(raw, request.headers.get("stripe-signature"), cfg.webhookSecret);
  if (!verified.ok) {
    console.warn("stripe webhook refused", { reason: verified.reason });
    return NextResponse.json({ ok: false, error: { code: "INVALID_SIGNATURE" } }, { status: 400 });
  }
  let event: { id?: unknown; type?: unknown };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_JSON" } }, { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.type !== "string") return NextResponse.json({ ok: false, error: { code: "INVALID_EVENT" } }, { status: 400 });

  const outcome = await processStripeEvent(event);
  return NextResponse.json({ ok: !outcome.retry, data: { status: outcome.status } }, { status: outcome.retry ? 500 : 200 });
}
