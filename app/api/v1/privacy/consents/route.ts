import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { listConsentRecords } from "@/modules/privacy/service";

/** The consent ledger, paginated at the database (?limit, ?offset). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("privacy.view");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50) || 50;
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0) || 0;
    return NextResponse.json({ ok: true, data: await listConsentRecords(ctx.tenantId!, { limit, offset }) });
  } catch (err) {
    return errorResponse(err);
  }
}
