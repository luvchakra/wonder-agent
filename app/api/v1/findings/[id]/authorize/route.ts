import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { authorizeRogueFinding } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/**
 * RISK-P0-13: approves rogue access afterwards, as it stands, or recognizes
 * it as legacy access, or covers it by a package the identity holds.
 * `{ kind: "authorize" | "legacy" | "package", reason, until?, packageId? }`
 * (until: optional end date, at most ten years away; the access is removed
 * then). `risk.manage`, plus `access.manage` for a package; never the
 * account's owner; audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // Adding the access to a package also changes the package: that needs access.manage too.
    if (body.kind === "package") await requirePermission("access.manage");
    const data = await authorizeRogueFinding(ctx.tenantId!, ctx.userId, id, { kind: body.kind, reason: body.reason, until: body.until, packageId: body.packageId });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
