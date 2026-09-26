import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { checkPackageEligibility, getPackage, updatePackage } from "@/modules/access-governance/service";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-20 — one package with its contents and risk; PATCH its fields
 * or status (access.manage). Outside access managers, a package is visible
 * only when it is active, requestable and the caller is eligible (its
 * policy controls discoverability, spec §12.3); otherwise 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    const pkg = await getPackage(ctx.tenantId!, id);
    if (!pkg) throw new ApiError(404, "NOT_FOUND", "No such package");
    if (!ctx.permissions.includes("access.manage")) {
      const me = await getIdentityForUser(ctx.tenantId!, ctx.userId);
      const eligible = me ? checkPackageEligibility(pkg, { identityType: me.identityType, department: me.department, status: me.status }).eligible : false;
      if (pkg.status !== "active" || !pkg.requestable || !eligible) throw new ApiError(404, "NOT_FOUND", "No such package");
    }
    return NextResponse.json({ ok: true, data: pkg });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await updatePackage(ctx.tenantId!, ctx.userId, id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
