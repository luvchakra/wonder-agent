import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assertUuid } from "@/lib/security/validate";
import { updateDataSource } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-13 — reclassify, re-own or retire a data source (audited). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    assertUuid(id, "id");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updated = await updateDataSource(ctx.tenantId!, ctx.userId, id, {
      classification: body.classification as string | null | undefined,
      status: body.status as "active" | "retired" | undefined,
      owner: body.owner as string | null | undefined,
    });
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
