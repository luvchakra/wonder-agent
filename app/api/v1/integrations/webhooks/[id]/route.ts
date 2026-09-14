import { NextResponse } from "next/server";
import { receiveWebhook } from "@/modules/integrations/service";

/**
 * INTEGRATION-P0-04.3. Machine-to-machine endpoint — no user session,
 * authenticated only by an HMAC-SHA256 signature over the raw request body
 * (see modules/integrations/webhooks.ts). Reads the body as raw text
 * (never JSON.parse then re-stringify) so the signature is verified over
 * the exact bytes the sender signed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature");

  const result = await receiveWebhook(id, rawBody, signature);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: { code: "REJECTED", message: result.reason } }, { status: result.status });
  }
  return NextResponse.json({ ok: true, data: null }, { status: 202 });
}
