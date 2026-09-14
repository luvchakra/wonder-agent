import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getFinding } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.read");
    const { id } = await params;
    const finding = await getFinding(ctx.tenantId!, id);
    if (!finding) return NextResponse.json({ ok: false, error: { code: "FINDING_NOT_FOUND" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: finding });
  } catch (err) {
    return errorResponse(err);
  }
}
