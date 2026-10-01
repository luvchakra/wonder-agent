import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertPlainObject } from "@/lib/security/validate";
import { listProcessingActivities, saveProcessingActivity } from "@/modules/privacy/service";

/** Records of processing activities (GDPR Art. 30). */
export async function GET() {
  try {
    const ctx = await requirePermission("privacy.view");
    return NextResponse.json({ ok: true, data: await listProcessingActivities(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("privacy.manage");
    const result = await saveProcessingActivity(ctx.tenantId!, ctx.userId, null, assertPlainObject(await request.json().catch(() => null), "body"));
    if (!result.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: "Check the highlighted fields", fields: result.errors } }, { status: 400 });
    return NextResponse.json({ ok: true, data: { id: result.id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
