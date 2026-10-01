import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertPlainObject } from "@/lib/security/validate";
import { listLegalHolds, placeLegalHold } from "@/modules/privacy/service";

export async function GET() {
  try {
    const ctx = await requirePermission("privacy.view");
    return NextResponse.json({ ok: true, data: await listLegalHolds(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("privacy.manage");
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    await placeLegalHold(ctx.tenantId!, ctx.userId, { name: body.name, reason: body.reason, categories: body.categories });
    return NextResponse.json({ ok: true, data: await listLegalHolds(ctx.tenantId!) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
