import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAuditLogs } from "@/modules/operations/service";
import { errorResponse } from "@/modules/operations/http";

/** OPERATIONS-P0-01.1 — tenant-scoped, paginated, filterable audit log viewer. */
export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("audit.read");
    const url = new URL(request.url);
    const filter = {
      objectType: url.searchParams.get("objectType") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      actorId: url.searchParams.get("actorId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    };
    const cursor = url.searchParams.get("cursor");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "50") || 50;
    const page = await listAuditLogs(ctx.tenantId!, filter, cursor, pageSize);
    return NextResponse.json({ ok: true, data: page });
  } catch (err) {
    return errorResponse(err);
  }
}
