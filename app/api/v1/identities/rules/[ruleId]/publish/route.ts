import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { approveIdentityRulePublish, requestIdentityRulePublish } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * IDENTITY-P0-21 — four-eyes publishing. `{ action: "request" }` asks (the
 * rule must have been simulated since its last edit); `{ action: "approve" }`
 * publishes the next version, by someone other than the person who asked.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { ruleId } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as { action?: unknown };
    if (body.action === "request") return NextResponse.json({ ok: true, data: await requestIdentityRulePublish(ctx.tenantId!, ctx.userId, ruleId) });
    if (body.action === "approve") return NextResponse.json({ ok: true, data: await approveIdentityRulePublish(ctx.tenantId!, ctx.userId, ruleId) });
    throw new ApiError(400, "VALIDATION_FAILED", "action: request or approve");
  } catch (err) {
    return errorResponse(err);
  }
}
