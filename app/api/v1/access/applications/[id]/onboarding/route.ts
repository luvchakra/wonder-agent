import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  answerOnboarding,
  configureOnboarding,
  decideOnboarding,
  getOnboarding,
  promoteOnboarding,
  simulateOnboarding,
  startOnboarding,
  validateOnboarding,
} from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";
import { ApiError } from "@/lib/shared/types/foundation";
import { refuseAutomationCaller } from "@/lib/security/automationCredentials";

// ACCESS-P0-16 — an application's onboarding (GET; null when not started)
// and its stages (POST { action }): start (optionally from a template,
// ACCESS-P0-34), configure, answer (the template's questionnaire), validate, simulate,
// approve, reject, promote. Stage, four-eyes and version checks are the
// service's; the tenant comes from the session (#2).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await getOnboarding(ctx.tenantId!, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const [tenantId, actorId] = [ctx.tenantId!, ctx.userId];
    let data;
    switch (body.action) {
      case "start":
        data = await startOnboarding(tenantId, actorId, id, body.mode, body.templateId);
        break;
      case "configure":
        data = await configureOnboarding(tenantId, actorId, id, (body.config ?? {}) as Record<string, unknown>);
        break;
      case "answer":
        data = await answerOnboarding(tenantId, actorId, id, body.answers);
        break;
      case "validate":
        data = await validateOnboarding(tenantId, actorId, id);
        break;
      case "simulate":
        data = await simulateOnboarding(tenantId, actorId, id);
        break;
      case "approve":
      case "reject":
        // WID-H06: the four-eyes approval of an onboarding is a person's decision.
        await refuseAutomationCaller("Approving an onboarding");
        data = await decideOnboarding(tenantId, actorId, id, { approve: body.action === "approve", note: body.note });
        break;
      case "promote":
        data = await promoteOnboarding(tenantId, actorId, id);
        break;
      default:
        throw new ApiError(400, "VALIDATION_FAILED", "action: start, configure, answer, validate, simulate, approve, reject or promote");
    }
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
