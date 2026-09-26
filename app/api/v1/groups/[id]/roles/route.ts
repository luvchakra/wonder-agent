import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { validateTerms } from "@/lib/rbac/assignmentRules";
import { addGroupRole } from "@/lib/users/groups";

// FOUNDATION-P0-26 — POST { role } (a role name) gives the group a role:
// every member gets it on their next request. Needs role assignment; a
// member of the group cannot give it roles (403 SELF_ESCALATION).
// FOUNDATION-P0-19 — also takes the assignment's terms: { scopeType,
// scopeValues[], startsAt, expiresAt, requiresMfa }; posting a role the
// group already carries changes its terms.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { role?: unknown; scopeType?: unknown; scopeValues?: unknown; startsAt?: unknown; expiresAt?: unknown; requiresMfa?: unknown };
  try {
    const ctx = await requireAnyPermission(["roles.assign", "role.manage"]);
    const role = typeof body.role === "string" ? body.role : "";
    if (!role) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "role is required" } }, { status: 400 });
    const terms = validateTerms(body, role, new Date());
    if (!terms.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid assignment terms", fields: terms.errors } }, { status: 400 });
    await addGroupRole(ctx.tenantId!, ctx.userId, (await params).id, role, terms.terms);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
