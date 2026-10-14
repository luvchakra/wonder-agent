import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { approveClassificationRulePublish, requestClassificationRulePublish } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * ACCESS-P0-33 — four-eyes publishing: `{ action: "request" }` asks (simulated
 * since its last edit); `{ action: "approve" }` publishes the next version, by
 * someone else, and applies an enforced rule to existing entitlements in scope.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { ruleId } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as { action?: unknown };
    if (body.action === "request") return NextResponse.json({ ok: true, data: await requestClassificationRulePublish(ctx.tenantId!, ctx.userId, ruleId) });
    if (body.action === "approve") return NextResponse.json({ ok: true, data: await approveClassificationRulePublish(ctx.tenantId!, ctx.userId, ruleId) });
    throw new ApiError(400, "VALIDATION_FAILED", "action: request or approve");
  } catch (err) {
    return errorResponse(err);
  }
}
