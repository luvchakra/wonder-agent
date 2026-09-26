import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assignRole, removeRole } from "@/lib/rbac/roles";
import { validateTerms } from "@/lib/rbac/assignmentRules";

// FOUNDATION-P0-23 — POST { role } assigns, DELETE ?role= removes. Nobody
// assigns themselves a role; the last Tenant Administrator keeps theirs.
// FOUNDATION-P0-19 — POST also takes the assignment's terms: { scopeType,
// scopeValues[], startsAt, expiresAt, requiresMfa } (organization-wide,
// permanent and unconditional when omitted); posting a role the user
// already holds changes its terms.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => null)) as { role?: unknown; scopeType?: unknown; scopeValues?: unknown; startsAt?: unknown; expiresAt?: unknown; requiresMfa?: unknown } | null;
  if (typeof body?.role !== "string" || !body.role) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "role is required" } }, { status: 400 });
  const terms = validateTerms(body, body.role, new Date());
  if (!terms.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid assignment terms", fields: terms.errors } }, { status: 400 });
  try {
    const ctx = await requireAnyPermission(["roles.assign", "role.manage"]);
    await assignRole(ctx.tenantId!, ctx.userId, (await params).id, body.role, terms.terms);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = new URL(req.url).searchParams.get("role");
  if (!role) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "role is required" } }, { status: 400 });
  try {
    const ctx = await requireAnyPermission(["roles.assign", "role.manage"]);
    await removeRole(ctx.tenantId!, ctx.userId, (await params).id, role);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
