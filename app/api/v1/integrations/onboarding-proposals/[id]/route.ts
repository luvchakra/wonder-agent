import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { applyOnboardingProposal, dismissOnboardingProposal } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";
import { ApiError } from "@/lib/shared/types/foundation";

// INTEGRATION-P0-12 — a person applies a proposal to the onboarding draft
// (also needs access.manage: it changes onboarding) or dismisses it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (body.action === "apply") {
      await requirePermission("access.manage");
      return NextResponse.json({ ok: true, data: await applyOnboardingProposal(ctx.tenantId!, ctx.userId, id) });
    }
    if (body.action === "dismiss") return NextResponse.json({ ok: true, data: await dismissOnboardingProposal(ctx.tenantId!, ctx.userId, id) });
    throw new ApiError(400, "VALIDATION_FAILED", "action: apply or dismiss");
  } catch (err) {
    return errorResponse(err);
  }
}
