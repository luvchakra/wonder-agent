import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { addPackageResource } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-20 — add a live application's access, or one of its entitlements, to a package. `{ applicationId, entitlementId? }` */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { applicationId?: unknown; entitlementId?: unknown };
    return NextResponse.json({ ok: true, data: await addPackageResource(ctx.tenantId!, ctx.userId, id, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
