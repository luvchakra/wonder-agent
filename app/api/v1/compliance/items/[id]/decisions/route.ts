import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { recordDecision } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";
import type { DecisionType } from "@/lib/shared/types/compliance";
import { refuseAutomationCaller } from "@/lib/security/automationCredentials";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // COMPLIANCE-P0-10: the item's assigned reviewer decides (a manager or an
    // application owner reviewing people's access); agent items still need compliance.manage (service).
    const ctx = await requirePermission("compliance.read");
    // WID-H06: certifying is a person's decision.
    await refuseAutomationCaller("A certification decision");
    const { id } = await params;
    const body = await request.json();
    const decision = await recordDecision(ctx.tenantId!, ctx.userId, id, {
      decision: body.decision as DecisionType,
      justification: String(body.justification ?? ""),
      delegateToUserId: body.delegateToUserId,
      overrideSoD: body.overrideSoD === true,
      until: typeof body.until === "string" ? body.until : undefined,
      canManageCompliance: ctx.permissions.includes("compliance.manage"),
    });
    return NextResponse.json({ ok: true, data: decision });
  } catch (err) {
    return errorResponse(err);
  }
}
