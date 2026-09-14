import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listCampaignItems } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.read");
    const { id } = await params;
    const items = await listCampaignItems(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: items });
  } catch (err) {
    return errorResponse(err);
  }
}
