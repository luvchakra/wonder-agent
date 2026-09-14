import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getCampaignMetrics } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

/** COMPLIANCE-P0-05 — a campaign's overdue/escalated counts. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.read");
    const { id } = await params;
    const metrics = await getCampaignMetrics(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: metrics });
  } catch (err) {
    return errorResponse(err);
  }
}
