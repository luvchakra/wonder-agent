import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listSavedReportDefinitions, saveReportDefinition } from "@/modules/operations/service";
import { errorResponse } from "@/modules/operations/http";
import type { ReportType } from "@/lib/shared/types/operations";

/** OPERATIONS-P0-04.1 — saved report definitions (filter + format), not generated output. */
export async function GET() {
  try {
    const ctx = await requirePermission("report.read");
    const reports = await listSavedReportDefinitions(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: reports });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("report.read");
    const body = await request.json();
    const report = await saveReportDefinition(ctx.tenantId!, ctx.userId, {
      reportType: body.reportType as ReportType,
      name: String(body.name ?? ""),
      filters: body.filters,
    });
    return NextResponse.json({ ok: true, data: report });
  } catch (err) {
    return errorResponse(err);
  }
}
