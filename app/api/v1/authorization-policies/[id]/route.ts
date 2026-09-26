import { NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { deleteAuthorizationPolicy, getAuthorizationPolicy, updateAuthorizationPolicy } from "@/lib/rbac/authorizationPolicies";

// FOUNDATION-P0-19 — one authorization policy: GET, PATCH (same body as
// POST), DELETE.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAnyPermission(["permissions.view", "tenant.security.manage"]);
    const policy = await getAuthorizationPolicy(ctx.tenantId!, (await params).id);
    if (!policy) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No such policy in this organization" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: policy });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const ctx = await requirePermission("tenant.security.manage");
    const result = await updateAuthorizationPolicy(ctx.tenantId!, ctx.userId, (await params).id, body);
    if (!result.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid policy", fields: result.errors } }, { status: 400 });
    return NextResponse.json({ ok: true, data: { id: result.id } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("tenant.security.manage");
    await deleteAuthorizationPolicy(ctx.tenantId!, ctx.userId, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
