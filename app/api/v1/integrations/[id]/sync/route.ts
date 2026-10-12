import { NextResponse, after } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createSyncJob, runSyncJob } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

/**
 * INTEGRATION-P0-01.3: creates the job (queued) and returns immediately;
 * the actual connector work runs via after() once the response has been
 * sent, never inline in this handler. See
 * modules/integrations/syncJobs.ts's runSyncJob() docblock for why after()
 * rather than a new queue dependency.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.execute");
    const { id } = await params;
    // INTEGRATION-P0-21: { "mode": "incremental" } asks for only what changed; the run reads in full when it cannot (chooseRunMode).
    const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
    if (body?.mode !== undefined && body.mode !== "full" && body.mode !== "incremental") {
      return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: "mode: full or incremental" } }, { status: 400 });
    }
    const job = await createSyncJob(ctx.tenantId!, id, "manual", body?.mode === "incremental" ? "incremental" : "full");

    after(() => runSyncJob(ctx.tenantId!, job.id));

    return NextResponse.json({ ok: true, data: job }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
