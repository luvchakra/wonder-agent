import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertPlainObject } from "@/lib/security/validate";
import { breachFacts, createBreach, listBreaches } from "@/modules/privacy/service";
import { breachObligations } from "@/modules/privacy/rules";

/** The breach register, each incident with its statutory notification obligations. */
export async function GET() {
  try {
    const ctx = await requirePermission("privacy.view");
    const now = new Date();
    const breaches = await listBreaches(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: breaches.map((b) => ({ ...b, obligations: breachObligations(breachFacts(b), now) })) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("privacy.incidents.manage");
    return NextResponse.json({ ok: true, data: await createBreach(ctx.tenantId!, ctx.userId, assertPlainObject(await request.json().catch(() => null), "body")) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
