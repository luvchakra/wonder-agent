import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { refuseAutomationCaller } from "@/lib/security/automationCredentials";
import { setPackageBirthright } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * IDENTITY-P0-18 / ACCESS-P0-20 (owner decision, 13 October 2026) — body
 * `{ "action": "request" | "approve" | "off" }`. Birthright assigns the
 * package to eligible joiners, rehires and movers without a request, so
 * turning it on takes two administrators (access.manage): one asks,
 * someone else approves. Approving is a person's decision: an automation
 * credential is refused (WID-H06).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (body.action === "approve") await refuseAutomationCaller("Approving birthright");
    return NextResponse.json({ ok: true, data: await setPackageBirthright(ctx.tenantId!, ctx.userId, id, body.action) });
  } catch (err) {
    return errorResponse(err);
  }
}
