import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getCertificationItemDetail } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.read");
    const { id } = await params;
    const detail = await getCertificationItemDetail(ctx.tenantId!, id);
    if (!detail) return NextResponse.json({ ok: false, error: { code: "ITEM_NOT_FOUND" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: detail });
  } catch (err) {
    return errorResponse(err);
  }
}
