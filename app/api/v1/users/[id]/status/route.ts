import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { changeUserStatus } from "@/lib/users/users";
import { STATUS_ACTIONS, type StatusAction } from "@/lib/users/userRules";

// FOUNDATION-P0-23 — POST { action: suspend | reactivate | deactivate | remove, reason }.
// Never your own membership; never the organization's last Tenant Administrator.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => null)) as { action?: unknown; reason?: unknown } | null;
  const action = body?.action;
  if (typeof action !== "string" || !(STATUS_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: `action must be one of ${STATUS_ACTIONS.join(", ")}` } }, { status: 400 });
  }
  try {
    const ctx = await requirePermission(action === "remove" ? "users.remove" : "users.suspend");
    const result = await changeUserStatus(ctx.tenantId!, ctx.userId, (await params).id, action as StatusAction, body?.reason);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return errorResponse(err);
  }
}
