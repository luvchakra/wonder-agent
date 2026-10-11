import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listAccessReconciliationRuns, reconcileApplicationAccess } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-27 — an application's entitlement and access reconciliation
// runs (GET) and a new one (POST): { "dryRun": true } previews and changes
// nothing; { "previewRunId": "<id>" } applies exactly that preview (409
// PLAN_CHANGED if the source or the records changed since); "mode" is full
// (default) or incremental. Nothing in the connected system changes.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await listAccessReconciliationRuns(ctx.tenantId!, id, 20) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = ((await request.json().catch(() => ({}))) ?? {}) as { dryRun?: unknown; previewRunId?: unknown; mode?: unknown };
    if (body.mode !== undefined && body.mode !== "full" && body.mode !== "incremental") throw new ApiError(400, "VALIDATION_FAILED", "mode: full or incremental");
    if (body.previewRunId !== undefined && typeof body.previewRunId !== "string") throw new ApiError(400, "VALIDATION_FAILED", "previewRunId: a run id");
    const run = await reconcileApplicationAccess(ctx.tenantId!, ctx.userId, id, {
      dryRun: body.dryRun === true,
      mode: (body.mode as "full" | "incremental" | undefined) ?? "full",
      previewRunId: (body.previewRunId as string | undefined) ?? null,
    });
    return NextResponse.json({ ok: true, data: run }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
