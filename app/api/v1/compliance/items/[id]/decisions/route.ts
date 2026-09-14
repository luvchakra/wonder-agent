import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { recordDecision } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";
import type { DecisionType } from "@/lib/shared/types/compliance";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const { id } = await params;
    const body = await request.json();
    const decision = await recordDecision(ctx.tenantId!, ctx.userId, id, {
      decision: body.decision as DecisionType,
      justification: String(body.justification ?? ""),
      delegateToUserId: body.delegateToUserId,
      overrideSoD: body.overrideSoD === true,
    });
    return NextResponse.json({ ok: true, data: decision });
  } catch (err) {
    return errorResponse(err);
  }
}
