import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertPlainObject } from "@/lib/security/validate";
import { getBillingProfile, saveBillingProfile } from "@/modules/billing/service";

export async function GET() {
  try {
    const ctx = await requirePermission("billing.view");
    return NextResponse.json({ ok: true, data: await getBillingProfile(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Any tenant_id in the body is ignored: the tenant is the session's (§14). */
export async function PUT(request: Request) {
  try {
    const ctx = await requirePermission("billing.manage");
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    const result = await saveBillingProfile(ctx.tenantId!, ctx.userId, body);
    if (!result.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: "Check the highlighted fields", fields: result.errors } }, { status: 400 });
    return NextResponse.json({ ok: true, data: result.profile });
  } catch (err) {
    return errorResponse(err);
  }
}
