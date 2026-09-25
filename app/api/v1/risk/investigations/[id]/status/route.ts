import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { changeInvestigationStatus } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";
import { ApiError } from "@/lib/shared/types/foundation";
import type { InvestigationStatus } from "@/lib/shared/types/risk";

const STATUSES: InvestigationStatus[] = ["open", "in_progress", "awaiting_remediation", "resolved", "closed"];

/** RISK-P0-11 — change status. Resolving is refused while any grouped finding is open. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: unknown; reason?: unknown };
    if (!STATUSES.includes(body.status as InvestigationStatus)) throw new ApiError(400, "VALIDATION_FAILED", `status: one of ${STATUSES.join(", ")}`);
    const reason = typeof body.reason === "string" ? body.reason : null;
    return NextResponse.json({ ok: true, data: await changeInvestigationStatus(ctx.tenantId!, ctx.userId, id, body.status as InvestigationStatus, reason) });
  } catch (err) {
    return errorResponse(err);
  }
}
