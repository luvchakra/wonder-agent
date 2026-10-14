import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { retireOnboardingTemplate } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-34 — retire a template: no longer offered; onboardings that used it keep it.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { templateId } = await params;
    return NextResponse.json({ ok: true, data: await retireOnboardingTemplate(ctx.tenantId!, ctx.userId, templateId) });
  } catch (err) {
    return errorResponse(err);
  }
}
