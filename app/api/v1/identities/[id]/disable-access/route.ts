import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { disableAllAccess } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

/**
 * IDENTITY-P0-18 (finish) — the manager's "disable all access": `{ reason }`.
 * A member who can request access (a manager) may do it for their own
 * direct report; an identity administrator for anyone. Which one the caller
 * is, is decided by the service from the database, never from the request.
 * The person is disabled and every grant becomes governed removal work.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAnyPermission(["identity.manage", "access.request"]);
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as { reason?: unknown };
    const event = await disableAllAccess(ctx.tenantId!, ctx.userId, id, { reason: body.reason, canManageIdentities: ctx.permissions.includes("identity.manage") });
    return NextResponse.json({ ok: true, data: event }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
