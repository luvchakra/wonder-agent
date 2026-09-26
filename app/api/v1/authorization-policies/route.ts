import { NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { createAuthorizationPolicy, listAuthorizationPolicies } from "@/lib/rbac/authorizationPolicies";

// FOUNDATION-P0-19 — GET the organization's authorization policies; POST
// { name, description?, effect: DENY | REQUIRE_APPROVAL, permissions[],
// scopeType?, scopeValues?[], exemptRoleIds?[] } creates one.
export async function GET() {
  try {
    const ctx = await requireAnyPermission(["permissions.view", "tenant.security.manage"]);
    return NextResponse.json({ ok: true, data: await listAuthorizationPolicies(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const ctx = await requirePermission("tenant.security.manage");
    const result = await createAuthorizationPolicy(ctx.tenantId!, ctx.userId, body);
    if (!result.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid policy", fields: result.errors } }, { status: 400 });
    return NextResponse.json({ ok: true, data: { id: result.id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
