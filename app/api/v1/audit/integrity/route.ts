import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { verifyAuditChain } from "@/lib/audit/integrity";

/** FOUNDATION-P0-29 — verify this tenant's hash-chained audit trail now. */
export async function GET() {
  try {
    const ctx = await requirePermission("audit.read");
    return NextResponse.json({ ok: true, data: await verifyAuditChain(ctx.tenantId!, ctx.userId) });
  } catch (err) {
    return errorResponse(err);
  }
}
