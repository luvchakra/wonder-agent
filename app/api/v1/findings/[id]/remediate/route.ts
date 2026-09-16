import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { remediateFinding } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/**
 * RISK-P0-03.2. Calls Access Agent's already-published `revokeAccessGrant()`
 * for every access_grant this finding's evidence names — `wired: true`
 * only when at least one grant was actually revoked; `false` (with a
 * reason in the audit event) for finding categories with no revocable
 * grant evidence. See docs/design/risk-agent-backlog-audit.md.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const { finding, wired, revokedGrantIds } = await remediateFinding(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: finding, wired, revokedGrantIds });
  } catch (err) {
    return errorResponse(err);
  }
}
