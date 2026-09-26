import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setApplicationLifecycle } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-16 — a live application's catalog lifecycle: POST { action:
// suspend | resume | retire, note }. Taking one out needs a reason.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const status = await setApplicationLifecycle(ctx.tenantId!, ctx.userId, id, body.action, body.note);
    return NextResponse.json({ ok: true, data: { onboardingStatus: status } });
  } catch (err) {
    return errorResponse(err);
  }
}
