import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { launchCampaignFromTemplate } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

/** COMPLIANCE-P0-14: launch an ordinary campaign from a template. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const { id } = await params;
    const campaign = await launchCampaignFromTemplate(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: campaign });
  } catch (err) {
    return errorResponse(err);
  }
}
