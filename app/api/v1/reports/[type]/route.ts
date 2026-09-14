import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { generateReport } from "@/modules/operations/service";
import { errorResponse } from "@/modules/operations/http";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ReportType } from "@/lib/shared/types/operations";

const VALID_TYPES: ReportType[] = [
  "agent_inventory",
  "ownership",
  "access_certification",
  "rogue_agent",
  "access_violation",
  "risk",
  "audit_evidence",
  "policy_compliance",
];

/** OPERATIONS-P0-04.1/04.2 — computed live at request time, carries generatedAt + per-row drill-through hrefs. */
export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const ctx = await requirePermission("report.read");
    const { type } = await params;
    if (!VALID_TYPES.includes(type as ReportType)) throw new ApiError(400, "INVALID_INPUT", `Unknown report type: ${type}`);
    const report = await generateReport(ctx.tenantId!, type as ReportType);
    return NextResponse.json({ ok: true, data: report });
  } catch (err) {
    return errorResponse(err);
  }
}
