import { NextRequest, NextResponse, after } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listReconciliationRuns, startReconciliation } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

// INTEGRATION-P0-09 — a source's reconciliation runs. POST queues a run and
// returns 202 at once; the pipeline runs after the response (§15).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { sourceId } = await params;
    return NextResponse.json({ ok: true, data: await listReconciliationRuns(ctx.tenantId!, sourceId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  try {
    const ctx = await requirePermission("integration.execute");
    const { sourceId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    const mode: "full" | "partial" = body.mode === "partial" ? "partial" : "full";
    const dryRun = body.dryRun === true;
    const input = body.kind === "integration" ? { kind: "integration" as const, mode, dryRun } : { kind: "upload" as const, csvText: String(body.csvText ?? ""), mode, dryRun };
    const { run, execute } = await startReconciliation(ctx.tenantId!, ctx.userId, sourceId, input);
    after(execute);
    return NextResponse.json({ ok: true, data: run }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
