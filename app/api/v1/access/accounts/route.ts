import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ACCOUNT_VIEWS, getAccountSummary, listAccountInventory, parseDormantDays, type AccountView } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-17 — the account inventory: GET ?view=all|orphan|ambiguous|
// dormant|privileged|missing &applicationId &q &dormantDays &page, paged
// at the database. The tenant comes from the session (#2).
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.read");
    const p = request.nextUrl.searchParams;
    const view = (ACCOUNT_VIEWS as string[]).includes(p.get("view") ?? "") ? (p.get("view") as AccountView) : "all";
    const dormantDays = parseDormantDays(p.get("dormantDays"));
    const applicationId = p.get("applicationId") ?? undefined;
    const [list, summary] = await Promise.all([
      listAccountInventory(ctx.tenantId!, { view, applicationId, q: p.get("q") ?? undefined, dormantDays, page: Number(p.get("page")) || 1, pageSize: Number(p.get("pageSize")) || 50 }),
      getAccountSummary(ctx.tenantId!, { applicationId, dormantDays }),
    ]);
    return NextResponse.json({ ok: true, data: list.rows, meta: { total: list.total, summary, dormantDays } });
  } catch (err) {
    return errorResponse(err);
  }
}
