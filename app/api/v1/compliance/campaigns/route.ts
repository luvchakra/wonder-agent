import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { launchCampaign, listCampaigns } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";
import type { CampaignCadence, CampaignScopeType } from "@/lib/shared/types/compliance";

export async function GET() {
  try {
    const ctx = await requirePermission("compliance.read");
    const campaigns = await listCampaigns(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: campaigns });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const body = await request.json();
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "name is required" } }, { status: 400 });
    }
    const campaign = await launchCampaign(ctx.tenantId!, ctx.userId, {
      name: body.name,
      scopeType: body.scopeType as CampaignScopeType,
      scope: body.scope ?? {},
      cadence: body.cadence as CampaignCadence,
      dueDate: body.dueDate,
      reviewerId: body.reviewerId ?? ctx.userId,
    });
    return NextResponse.json({ ok: true, data: campaign });
  } catch (err) {
    return errorResponse(err);
  }
}
