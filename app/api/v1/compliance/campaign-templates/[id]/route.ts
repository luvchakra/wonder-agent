import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { archiveCampaignTemplate } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

/** COMPLIANCE-P0-14: archive a template (never deleted). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const { id } = await params;
    await archiveCampaignTemplate(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
