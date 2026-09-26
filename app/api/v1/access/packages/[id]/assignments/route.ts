import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assignPackageDirect, getPackage, listAssignments, sweepPackageExpiry } from "@/modules/access-governance/service";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-20 — a package's assignments (?live=1, &page), with their work
 * items — all of them for access managers, fulfillers and the package's
 * owner, otherwise only the caller's own; POST assigns it directly (access.manage):
 * `{ identityId, durationDays?, justification }`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    await sweepPackageExpiry(ctx.tenantId!);
    const p = request.nextUrl.searchParams;
    // Holders are visible to those who manage or fulfil access and to the package's owner; anyone else sees only their own.
    const admin = ctx.permissions.includes("access.manage") || ctx.permissions.includes("access.approve");
    const [me, pkg] = admin ? [null, null] : await Promise.all([getIdentityForUser(ctx.tenantId!, ctx.userId), getPackage(ctx.tenantId!, id)]);
    const seesAll = admin || (me !== null && pkg?.ownerIdentityId === me.id);
    const { rows, total } = await listAssignments(ctx.tenantId!, { packageId: id, live: p.get("live") === "1", page: Number(p.get("page")) || 1, ...(seesAll ? {} : { identityId: me?.id ?? "none" }) });
    return NextResponse.json({ ok: true, data: rows, meta: { total } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await assignPackageDirect(ctx.tenantId!, ctx.userId, { ...body, packageId: id }) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
