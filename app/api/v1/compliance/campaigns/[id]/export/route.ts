import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { exportCampaignEvidence } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

/** COMPLIANCE-P0-06 — tamper-evident evidence export package for a campaign. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const { id } = await params;
    const pkg = await exportCampaignEvidence(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: pkg });
  } catch (err) {
    return errorResponse(err);
  }
}
