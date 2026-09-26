import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getInventoryAccount, linkAccount } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-17 — one account (GET) and linking it to an identity by hand
// (PATCH { identityId }, null to unlink). Audited.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    const account = await getInventoryAccount(ctx.tenantId!, id);
    if (!account) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No such account" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: account });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await linkAccount(ctx.tenantId!, ctx.userId, id, body.identityId ?? null) });
  } catch (err) {
    return errorResponse(err);
  }
}
