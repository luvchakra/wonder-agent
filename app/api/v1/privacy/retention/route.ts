import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertNonEmptyString, assertPlainObject } from "@/lib/security/validate";
import { listRetentionPolicies, saveRetentionPolicy } from "@/modules/privacy/service";

export async function GET() {
  try {
    const ctx = await requirePermission("privacy.view");
    return NextResponse.json({ ok: true, data: await listRetentionPolicies(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requirePermission("privacy.manage");
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    await saveRetentionPolicy(ctx.tenantId!, ctx.userId, assertNonEmptyString(body.category, "category", { maxLength: 40 }), Number(body.retentionDays), body.enabled !== false);
    return NextResponse.json({ ok: true, data: await listRetentionPolicies(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}
