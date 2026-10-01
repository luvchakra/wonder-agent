import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { getBillingOverview } from "@/modules/billing/service";

/** PLATFORM-P1-04 — the tenant's plan, usage, prices, billing profile and latest invoices. */
export async function GET() {
  try {
    const ctx = await requirePermission("billing.view");
    return NextResponse.json({ ok: true, data: await getBillingOverview(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}
