import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { resolvePendingCorrelation } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

// A person's decision on an ambiguous match: { action: "link", identityId } |
// { action: "create" } | { action: "dismiss" }. It changes an identity, so
// it needs identity.manage.
export async function POST(request: NextRequest, { params }: { params: Promise<{ pendingId: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { pendingId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await resolvePendingCorrelation(ctx.tenantId!, ctx.userId, pendingId, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
