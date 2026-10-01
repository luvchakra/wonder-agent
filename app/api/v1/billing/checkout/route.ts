import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertNonEmptyString, assertPlainObject } from "@/lib/security/validate";
import { startCheckout } from "@/modules/billing/service";

/** Starts a hosted checkout (Stripe Checkout or a Razorpay subscription link) and returns its URL. */
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("billing.manage");
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    const priceId = assertNonEmptyString(body.priceId, "priceId", { maxLength: 60 });
    const result = await startCheckout(ctx.tenantId!, ctx.userId, priceId, new URL(request.url).origin);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return errorResponse(err);
  }
}
