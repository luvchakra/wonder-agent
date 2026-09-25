import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createIdentity, listIdentities } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import { IDENTITY_STATUSES, IDENTITY_TYPES, type IdentityStatus, type IdentityType } from "@/lib/shared/types/agent-identity";

// IDENTITY-P0-15 — the WonderID identity directory. Tenant from the
// session, never from the request (#2).
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("identity.read");
    const sp = request.nextUrl.searchParams;
    const types = sp
      .getAll("type")
      .flatMap((t) => t.split(","))
      .filter((t): t is IdentityType => (IDENTITY_TYPES as readonly string[]).includes(t));
    const status = sp.get("status");
    const result = await listIdentities(ctx.tenantId!, {
      types,
      status: status && (IDENTITY_STATUSES as readonly string[]).includes(status) ? (status as IdentityStatus) : undefined,
      q: sp.get("q") ?? undefined,
      page: Number.parseInt(sp.get("page") ?? "1", 10) || 1,
      pageSize: Number.parseInt(sp.get("pageSize") ?? "50", 10) || 50,
    });
    return NextResponse.json({ ok: true, data: result.rows, total: result.total });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("identity.manage");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: "JSON body required" } }, { status: 400 });
    // Any tenantId in the body is ignored: the service writes the session's tenant.
    const identity = await createIdentity(ctx.tenantId!, ctx.userId, body);
    return NextResponse.json({ ok: true, data: identity }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
