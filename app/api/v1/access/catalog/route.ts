import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listRequestCatalog } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-18 — the request catalog: live applications and entitlements,
// the policy that governs each and its assessed risk. GET ?q &page
// &requestable=1 (only what a policy makes requestable).
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.read");
    const p = request.nextUrl.searchParams;
    const { items, total } = await listRequestCatalog(ctx.tenantId!, { q: p.get("q") ?? undefined, page: Number(p.get("page")) || 1, requestableOnly: p.get("requestable") === "1" });
    return NextResponse.json({ ok: true, data: items, meta: { total } });
  } catch (err) {
    return errorResponse(err);
  }
}
