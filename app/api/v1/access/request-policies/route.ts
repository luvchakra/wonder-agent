import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listRequestPolicies, saveRequestPolicy } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-18 — request policies. GET lists them; POST creates the policy
// for a scope (tenant default, an application, or one of its entitlements)
// or updates the one that scope already has.
export async function GET() {
  try {
    const ctx = await requirePermission("access.read");
    return NextResponse.json({ ok: true, data: await listRequestPolicies(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.manage");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await saveRequestPolicy(ctx.tenantId!, ctx.userId, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
