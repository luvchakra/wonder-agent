import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { escalateOverdueItems } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

/**
 * COMPLIANCE-P0-05. No scheduler exists in this codebase yet, so this is an
 * operator-triggered (or, once a job runner exists, cron-triggered) sweep
 * across every campaign in the tenant rather than a per-campaign action.
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
