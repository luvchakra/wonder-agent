import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { exportAuditLogs, toCsv } from "@/modules/operations/service";
import { errorResponse } from "@/modules/operations/http";

/** OPERATIONS-P0-01.2 — downloadable CSV/JSON evidence bundle, gated on report.export same as every other export path. */
export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("report.export");
    const url = new URL(request.url);
    const filter = {
      objectType: url.searchParams.get("objectType") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      actorId: url.searchParams.get("actorId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    };
    const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
    const entries = await exportAuditLogs(ctx.tenantId!, filter);

    if (format === "csv") {
      const csv = toCsv(entries.map((e) => ({ ...e, metadata: JSON.stringify(e.metadata) })));
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=audit-evidence.csv" } });
    }
    return NextResponse.json({ ok: true, data: entries });
  } catch (err) {
    return errorResponse(err);
  }
}
