import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertPlainObject, assertUuid } from "@/lib/security/validate";
import { saveProcessingActivity, setProcessingActivityStatus } from "@/modules/privacy/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("privacy.manage");
    const id = assertUuid((await params).id, "id");
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    if (body.status === "active" || body.status === "retired") {
      await setProcessingActivityStatus(ctx.tenantId!, ctx.userId, id, body.status);
      return NextResponse.json({ ok: true, data: { id } });
    }
    const result = await saveProcessingActivity(ctx.tenantId!, ctx.userId, id, body);
    if (!result.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: "Check the highlighted fields", fields: result.errors } }, { status: 400 });
    return NextResponse.json({ ok: true, data: { id } });
  } catch (err) {
    return errorResponse(err);
  }
}
