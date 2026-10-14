import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createClassificationRule, listClassificationRules } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-33 — entitlement classification rules. Reading needs access.read; writing access.manage.
export async function GET() {
  try {
    const ctx = await requirePermission("access.read");
    return NextResponse.json({ ok: true, data: await listClassificationRules(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `{ name, triggerType, applicationIds?, condition, effects, mode?, priority?, description? }`; starts report-only. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.manage");
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await createClassificationRule(ctx.tenantId!, ctx.userId, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
