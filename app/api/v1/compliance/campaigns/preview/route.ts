import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { previewCampaign } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";
import type { CampaignCadence, CampaignScopeType } from "@/lib/shared/types/compliance";

/** COMPLIANCE-P0-14: what a campaign would hold, counted, nothing written. */
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const preview = await previewCampaign(ctx.tenantId!, {
      name: "preview",
      scopeType: body.scopeType as CampaignScopeType,
      scope: (body.scope as Record<string, unknown>) ?? {},
      cadence: ((body.cadence as CampaignCadence) || "one_time") as CampaignCadence,
      reviewerId: typeof body.reviewerId === "string" && body.reviewerId ? body.reviewerId : ctx.userId,
      reviewerKind: body.reviewerKind as "named" | "manager" | "application_owner" | undefined,
    });
    return NextResponse.json({ ok: true, data: preview });
  } catch (err) {
    return errorResponse(err);
  }
}
