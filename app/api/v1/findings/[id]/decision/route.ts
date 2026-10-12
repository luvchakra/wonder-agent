import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { decideRogueFinding } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/**
 * WID-H04 (owner decision 2026-10-12): closes a rogue-access finding
 * without removing the access. `{ outcome: "exception", reason, until }`
 * (until: at most 90 days away) or `{ outcome: "false_positive", reason }`.
 * `risk.manage`; never the account's owner; audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const data = await decideRogueFinding(ctx.tenantId!, ctx.userId, id, { outcome: body.outcome, reason: body.reason, until: body.until });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
