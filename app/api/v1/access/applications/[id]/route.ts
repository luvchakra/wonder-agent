import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getApplicationDetail, updateApplication } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-15 — one catalog application (GET) and its catalog fields (PATCH).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    const app = await getApplicationDetail(ctx.tenantId!, id);
    if (!app) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No such application" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: app });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await updateApplication(ctx.tenantId!, ctx.userId, id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
