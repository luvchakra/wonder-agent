import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { errorResponse } from "@/modules/platform-admin/http";
import { assertOneOf, assertPlainObject, assertUuid } from "@/lib/security/validate";
import { listAdjustments, requestAdjustment } from "@/modules/billing/adjustments";

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin();
    const tenantId = request.nextUrl.searchParams.get("tenantId") ?? undefined;
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    return NextResponse.json({ ok: true, data: await listAdjustments({ tenantId: tenantId ? assertUuid(tenantId, "tenantId") : undefined, status }) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Maker step: request a refund, plan override or immediate cancellation. */
export async function POST(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    const adj = await requestAdjustment(userId, {
      tenantId: assertUuid(body.tenantId, "tenantId"),
      kind: assertOneOf(body.kind, ["refund", "plan_override", "cancel_immediately"] as const, "kind"),
      invoiceId: body.invoiceId ? assertUuid(body.invoiceId, "invoiceId") : null,
      amount: typeof body.amount === "number" ? body.amount : null,
      targetPlan: body.targetPlan ? assertOneOf(body.targetPlan, ["free", "pro", "max", "enterprise"] as const, "targetPlan") : null,
      reason: String(body.reason ?? ""),
    });
    return NextResponse.json({ ok: true, data: adj });
  } catch (err) {
    return errorResponse(err);
  }
}
