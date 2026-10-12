import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { requestAccessFindingRemoval } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/**
 * RISK-P0-13 (core, F3): asks for a rogue-access finding's access to be
 * removed (or its account disabled), as an ordinary request under the
 * application's request policy; the connector and reconciliation do the
 * rest, and the finding resolves when the access is gone. `risk.manage`;
 * the request itself is checked as the caller's (requesting for others).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const data = await requestAccessFindingRemoval(ctx.tenantId!, { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage") }, id);
    return NextResponse.json({ ok: true, data }, { status: data.duplicate ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
