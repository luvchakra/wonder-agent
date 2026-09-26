import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { createPackage, listPackages } from "@/modules/access-governance/service";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-20 — access packages. GET ?view=browse (default: what the
// caller may discover and request) or ?view=manage (every package, for
// access managers; ?status=), &q &page. POST creates a draft (access.manage).
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.read");
    const p = request.nextUrl.searchParams;
    const manage = p.get("view") === "manage";
    if (manage && !ctx.permissions.includes("access.manage")) throw new ApiError(403, "FORBIDDEN", "Missing permission: access.manage");
    const me = manage ? null : await getIdentityForUser(ctx.tenantId!, ctx.userId);
    const { items, total } = await listPackages(ctx.tenantId!, {
      q: p.get("q") ?? undefined,
      status: p.get("status") ?? undefined,
      page: Number(p.get("page")) || 1,
      ...(manage ? {} : { discoverFor: me ? { identityType: me.identityType, department: me.department } : null }),
    });
    return NextResponse.json({ ok: true, data: items, meta: { total } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("access.manage");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const pkg = await createPackage(ctx.tenantId!, ctx.userId, body);
    return NextResponse.json({ ok: true, data: pkg }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
