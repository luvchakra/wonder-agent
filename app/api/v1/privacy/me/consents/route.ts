import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { errorResponse } from "@/lib/shared/apiError";
import { assertPlainObject, assertUuid } from "@/lib/security/validate";
import { grantMyConsent, listMyConsents, withdrawMyConsent } from "@/modules/privacy/service";

/** Grant or withdraw my consent to a purpose: { purposeId, grant: boolean }. */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext();
    if (!ctx.tenantId) return NextResponse.json({ ok: false, error: { code: "NO_TENANT" } }, { status: 401 });
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    const purposeId = assertUuid(body.purposeId, "purposeId");
    const h = await headers();
    if (body.grant === true) await grantMyConsent(ctx.tenantId, ctx.userId, purposeId, typeof body.language === "string" ? body.language : "en", { userAgent: h.get("user-agent") });
    else await withdrawMyConsent(ctx.tenantId, ctx.userId, purposeId);
    return NextResponse.json({ ok: true, data: await listMyConsents(ctx.tenantId, ctx.userId) });
  } catch (err) {
    return errorResponse(err);
  }
}
