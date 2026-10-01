import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { cancelSubscriptionAtPeriodEnd, resumeSubscription } from "@/modules/billing/service";

/** Cancel at the end of the paid period. */
export async function DELETE() {
  try {
    const ctx = await requirePermission("billing.manage");
    await cancelSubscriptionAtPeriodEnd(ctx.tenantId!, ctx.userId);
    return NextResponse.json({ ok: true, data: { status: "cancellation_scheduled" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Undo a scheduled cancellation (Stripe). */
export async function PATCH() {
  try {
    const ctx = await requirePermission("billing.manage");
    await resumeSubscription(ctx.tenantId!, ctx.userId);
    return NextResponse.json({ ok: true, data: { status: "resumed" } });
  } catch (err) {
    return errorResponse(err);
  }
}
