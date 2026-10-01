import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertUuid } from "@/lib/security/validate";
import { releaseLegalHold } from "@/modules/privacy/service";

/** Releases (never deletes) a legal hold. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("privacy.manage");
    await releaseLegalHold(ctx.tenantId!, ctx.userId, assertUuid((await params).id, "id"));
    return NextResponse.json({ ok: true, data: { released: true } });
  } catch (err) {
    return errorResponse(err);
  }
}
