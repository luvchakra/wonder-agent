import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertPlainObject, assertUuid } from "@/lib/security/validate";
import { closeBreach, updateBreach } from "@/modules/privacy/service";

/** Record containment, notifications (set once, never rewritten), root cause and remediation. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("privacy.incidents.manage");
    const id = assertUuid((await params).id, "id");
    return NextResponse.json({ ok: true, data: await updateBreach(ctx.tenantId!, ctx.userId, id, assertPlainObject(await request.json().catch(() => null), "body")) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Close: refused while a required notification is unrecorded without a reason for delay. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("privacy.incidents.manage");
    return NextResponse.json({ ok: true, data: await closeBreach(ctx.tenantId!, ctx.userId, assertUuid((await params).id, "id")) });
  } catch (err) {
    return errorResponse(err);
  }
}
