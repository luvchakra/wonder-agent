import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { authorizeRogueFinding } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/**
 * RISK-P0-13: approves rogue access afterwards, as it stands, or recognizes
 * it as legacy access. `{ kind: "authorize" | "legacy", reason, until? }`
 * (until: optional end date, at most ten years away; the access is removed
 * then). `risk.manage`; never the account's owner; audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const data = await authorizeRogueFinding(ctx.tenantId!, ctx.userId, id, { kind: body.kind, reason: body.reason, until: body.until });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
