import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { explainAccessPath } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { agentId } = await params;
    const resource = request.nextUrl.searchParams.get("resource");
    if (!resource) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "resource query param is required" } },
        { status: 400 },
      );
    }
    const path = await explainAccessPath(ctx.tenantId!, agentId, resource);
    if (!path) {
      return NextResponse.json({ ok: false, error: { code: "PATH_NOT_FOUND" } }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: path });
  } catch (err) {
    return errorResponse(err);
  }
}
