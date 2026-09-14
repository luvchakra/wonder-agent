import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { generateReport, toCsv } from "@/modules/operations/service";
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

/** OPERATIONS-P0-04.1 — report export, gated on report.export same as every other export path. */
export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const ctx = await requirePermission("report.export");
    const { type } = await params;
    if (!VALID_TYPES.includes(type as ReportType)) throw new ApiError(400, "INVALID_INPUT", `Unknown report type: ${type}`);
    const report = await generateReport(ctx.tenantId!, type as ReportType);

    const url = new URL(request.url);
    if (url.searchParams.get("format") === "csv") {
      const csv = toCsv(report.rows.map((r) => ({ id: r.id, href: r.href, ...r.fields })));
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename=${type}.csv` } });
    }
    return NextResponse.json({ ok: true, data: report });
  } catch (err) {
    return errorResponse(err);
  }
}
