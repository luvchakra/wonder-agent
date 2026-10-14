import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createOnboardingTemplate, listOnboardingTemplates } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-34 — application onboarding templates. Reading needs access.read; writing access.manage.
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.read");
    const includeRetired = request.nextUrl.searchParams.get("include") === "retired";
    return NextResponse.json({ ok: true, data: await listOnboardingTemplates(ctx.tenantId!, { includeRetired }) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `{ name, description?, connectionTypeKey?, defaults?, entitlementTypes?, questions? }`. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.manage");
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await createOnboardingTemplate(ctx.tenantId!, ctx.userId, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
