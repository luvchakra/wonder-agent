import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getOnboardingTemplate, updateOnboardingTemplate } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";
import { ApiError } from "@/lib/shared/types/foundation";

// ACCESS-P0-34 — one onboarding template; another organization's is not found.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { templateId } = await params;
    const template = await getOnboardingTemplate(ctx.tenantId!, templateId);
    if (!template) throw new ApiError(404, "NOT_FOUND", "No such template");
    return NextResponse.json({ ok: true, data: template });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { templateId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await updateOnboardingTemplate(ctx.tenantId!, ctx.userId, templateId, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
