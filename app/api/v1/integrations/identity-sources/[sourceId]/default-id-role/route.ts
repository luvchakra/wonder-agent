import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setSourceDefaultIdRole } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";
import { refuseAutomationCaller } from "@/lib/security/automationCredentials";

/**
 * Owner decision 2026-10-14 — the ID role an identity source's new people
 * are invited with: `{ role: "<ID role name>" | null }`. Choosing a role
 * gives WonderID access, so it also needs role assignment, and it is a
 * person's decision (never an automation credential's).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    await refuseAutomationCaller("Setting the default ID role of an identity source");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (body.role && !ctx.permissions.some((p) => p === "roles.assign" || p === "role.manage") ) {
      return NextResponse.json({ ok: false, error: { code: "FORBIDDEN", message: "Choosing a default ID role also needs role management" } }, { status: 403 });
    }
    if (body.role && !ctx.permissions.includes("users.invite")) {
      return NextResponse.json({ ok: false, error: { code: "FORBIDDEN", message: "Choosing a default ID role also needs permission to invite users" } }, { status: 403 });
    }
    const { sourceId } = await params;
    return NextResponse.json({ ok: true, data: await setSourceDefaultIdRole(ctx.tenantId!, { userId: ctx.userId, permissions: ctx.permissions }, sourceId, body.role ?? null) });
  } catch (err) {
    return errorResponse(err);
  }
}
