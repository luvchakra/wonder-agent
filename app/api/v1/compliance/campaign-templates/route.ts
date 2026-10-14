import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listCampaignTemplates, saveCampaignTemplate } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

/** COMPLIANCE-P0-14: campaign templates. Reading needs compliance.read; saving, compliance.manage. */
export async function GET() {
  try {
    const ctx = await requirePermission("compliance.read");
    return NextResponse.json({ ok: true, data: await listCampaignTemplates(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const template = await saveCampaignTemplate(ctx.tenantId!, ctx.userId, body);
    return NextResponse.json({ ok: true, data: template }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
