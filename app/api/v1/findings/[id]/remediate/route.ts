import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { remediateFinding } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/**
 * RISK-P0-03.2. Access Agent has not published a remediation-initiation
 * contract yet, so this endpoint never performs a real hand-off — it
 * records the request and reports `wired: false` rather than fabricating
 * one, per the backlog's explicit instruction. See
 * docs/design/risk-agent-backlog-audit.md.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const { finding, wired } = await remediateFinding(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: finding, wired });
  } catch (err) {
    return errorResponse(err);
  }
}
