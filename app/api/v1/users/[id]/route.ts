import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { getUserDetail } from "@/lib/users/users";

// FOUNDATION-P0-23 — one user of the caller's organization: membership
// state, roles with who granted them, and effective permissions with the
// roles that grant each. 404 for anyone outside this organization.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("users.view");
    const user = await getUserDetail(ctx.tenantId!, (await params).id);
    if (!user) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No such user in this organization" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: user });
  } catch (err) {
    return errorResponse(err);
  }
}
