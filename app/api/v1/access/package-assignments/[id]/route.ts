import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getAssignment, getPackage, sweepPackageExpiry } from "@/modules/access-governance/service";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-20 — one package assignment with its work items (an assignment past its end is expired first). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    await sweepPackageExpiry(ctx.tenantId!);
    const a = await getAssignment(ctx.tenantId!, id);
    if (!a) throw new ApiError(404, "NOT_FOUND", "No such assignment");
    // Someone else's assignment is visible to those who manage or fulfil access and to the package's owner only.
    if (!ctx.permissions.includes("access.manage") && !ctx.permissions.includes("access.approve")) {
      const [me, pkg] = await Promise.all([getIdentityForUser(ctx.tenantId!, ctx.userId), getPackage(ctx.tenantId!, a.packageId)]);
      if (a.identityId !== me?.id && (!me || pkg?.ownerIdentityId !== me.id)) throw new ApiError(404, "NOT_FOUND", "No such assignment");
    }
    return NextResponse.json({ ok: true, data: a });
  } catch (err) {
    return errorResponse(err);
  }
}
