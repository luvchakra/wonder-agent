import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { modelAfter } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-38 — `?subject=<identity>&model=<identity>`: the lines that would give the subject the
 * model's requestable access, minus what the subject has or asked for, each exclusion with its reason.
 * Proposes; sends nothing. The model's access is shown to an access manager, the model, or their manager.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.request");
    const p = request.nextUrl.searchParams;
    const data = await modelAfter(ctx.tenantId!, { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage") }, p.get("subject"), p.get("model"));
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
