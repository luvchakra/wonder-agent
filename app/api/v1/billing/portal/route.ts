import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { openBillingPortal } from "@/modules/billing/service";

/** A Stripe Billing Portal session (payment methods, invoices, plan changes). */
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("billing.manage");
    const url = await openBillingPortal(ctx.tenantId!, ctx.userId, new URL(request.url).origin);
    return NextResponse.json({ ok: true, data: { url } });
  } catch (err) {
    return errorResponse(err);
  }
}
