import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { escalateOverdueItems } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

/**
 * COMPLIANCE-P0-05. Operator/API-triggered sweep across every campaign in
 * the calling tenant, for an admin who wants to run escalation on demand
 * rather than wait for the daily automatic sweep. The automatic path is
 * `app/api/cron/compliance-escalate-overdue/route.ts`, wired to Vercel
 * Cron via `vercel.json` — it calls the same underlying
 * `escalateOverdueItems()` across every tenant, not just this one.
 */
export async function POST() {
  try {
    const ctx = await requirePermission("compliance.manage");
    const escalatedCount = await escalateOverdueItems(ctx.tenantId!, ctx.userId);
    return NextResponse.json({ ok: true, data: { escalatedCount } });
  } catch (err) {
    return errorResponse(err);
  }
}
