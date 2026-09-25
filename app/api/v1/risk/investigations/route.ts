import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createInvestigation, listInvestigations, validateCreateInvestigation } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";
import type { InvestigationStatus } from "@/lib/shared/types/risk";

const STATUSES: InvestigationStatus[] = ["open", "in_progress", "awaiting_remediation", "resolved", "closed"];

/** RISK-P0-11 — investigations: list (risk.read) and create (risk.manage). */
export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("risk.read");
    const status = new URL(request.url).searchParams.get("status");
    const data = await listInvestigations(ctx.tenantId!, { status: STATUSES.includes(status as InvestigationStatus) ? (status as InvestigationStatus) : undefined });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("risk.manage");
    const input = validateCreateInvestigation(await request.json().catch(() => null));
    return NextResponse.json({ ok: true, data: await createInvestigation(ctx.tenantId!, ctx.userId, input) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
