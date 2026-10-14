import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getClassificationRule, updateClassificationRule } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";
import { ApiError } from "@/lib/shared/types/foundation";

// ACCESS-P0-33 — one classification rule; PATCH edits its working copy.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { ruleId } = await params;
    const rule = await getClassificationRule(ctx.tenantId!, ruleId);
    if (!rule) throw new ApiError(404, "NOT_FOUND", "No such rule");
    return NextResponse.json({ ok: true, data: rule });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { ruleId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await updateClassificationRule(ctx.tenantId!, ctx.userId, ruleId, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
