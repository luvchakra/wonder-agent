import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createIdentityRule, listIdentityRules } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

// IDENTITY-P0-21 — the organization's attribute rules. Reading needs identity.read; writing identity.manage.
export async function GET() {
  try {
    const ctx = await requirePermission("identity.read");
    return NextResponse.json({ ok: true, data: await listIdentityRules(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `{ name, triggerType, triggerAttribute?, triggerSource?, scope?, condition, effects, mode?, priority?, description? }`; starts report-only. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("identity.manage");
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await createIdentityRule(ctx.tenantId!, ctx.userId, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
