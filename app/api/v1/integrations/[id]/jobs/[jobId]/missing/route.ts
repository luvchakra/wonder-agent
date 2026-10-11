import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { resolveHeldMissing } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

/**
 * INTEGRATION-P0-18: approve or discard a run the mass-missing guard held.
 * Body: { "decision": "approve" | "discard" }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { id, jobId } = await params;
    const body = (await request.json().catch(() => null)) as { decision?: unknown } | null;
    const decision = body?.decision;
    if (decision !== "approve" && decision !== "discard") {
      throw new ApiError(400, "INVALID_DECISION", 'decision must be "approve" or "discard"');
    }
    const job = await resolveHeldMissing(ctx.tenantId!, ctx.userId, id, jobId, decision);
    return NextResponse.json({ ok: true, data: job });
  } catch (err) {
    return errorResponse(err);
  }
}
