import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getFinding, resolveFinding, evaluateAgentRisk } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";
import type { ResolutionType } from "@/lib/shared/types/risk";

/**
 * RISK-P0-03.3. `verified_fixed` requires the same detection rule to no
 * longer trigger — proven here by re-running the full detection engine
 * (idempotent: it only creates/updates a finding for categories that still
 * trigger) and checking whether this finding's category is still among the
 * result. `accepted_risk` skips the re-check by design (a human is
 * explicitly overriding, per the backlog).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = await request.json();
    const type = body.type as ResolutionType;
    if (type !== "verified_fixed" && type !== "accepted_risk" && type !== "false_positive") {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "type must be verified_fixed, accepted_risk, or false_positive" } },
        { status: 400 },
      );
    }

    const existing = await getFinding(ctx.tenantId!, id);
    if (!existing) return NextResponse.json({ ok: false, error: { code: "FINDING_NOT_FOUND" } }, { status: 404 });

    let stillTriggered = false;
    if (type === "verified_fixed") {
      const reEvaluated = await evaluateAgentRisk(ctx.tenantId!, existing.agentId);
      stillTriggered = reEvaluated.some((f) => f.category === existing.category);
    }

    const finding = await resolveFinding(ctx.tenantId!, ctx.userId, id, {
      type,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      stillTriggered,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
    });
    return NextResponse.json({ ok: true, data: finding });
  } catch (err) {
    return errorResponse(err);
  }
}
