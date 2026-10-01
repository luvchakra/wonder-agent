import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { listInvoices } from "@/modules/billing/service";

/** Paginated at the database: ?limit=1..100&offset=n. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("billing.view");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25) || 25;
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0) || 0;
    return NextResponse.json({ ok: true, data: await listInvoices(ctx.tenantId!, { limit, offset }) });
  } catch (err) {
    return errorResponse(err);
  }
}
