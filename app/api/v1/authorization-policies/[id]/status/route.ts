import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { setAuthorizationPolicyStatus } from "@/lib/rbac/authorizationPolicies";

// FOUNDATION-P0-19 — POST { status: "active" | "inactive" }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { status?: unknown };
  if (body.status !== "active" && body.status !== "inactive") {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "status must be active or inactive" } }, { status: 400 });
  }
  try {
    const ctx = await requirePermission("tenant.security.manage");
    await setAuthorizationPolicyStatus(ctx.tenantId!, ctx.userId, (await params).id, body.status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
