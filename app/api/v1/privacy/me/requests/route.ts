import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { errorResponse } from "@/lib/shared/apiError";
import { assertPlainObject } from "@/lib/security/validate";
import { createMyRequest, listMyRequests } from "@/modules/privacy/service";

export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx.tenantId) return NextResponse.json({ ok: false, error: { code: "NO_TENANT" } }, { status: 401 });
    return NextResponse.json({ ok: true, data: await listMyRequests(ctx.tenantId, ctx.userId) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Exercise a right: { regime, requestType, description? }. The deadline is set from the law, not the caller. */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext();
    if (!ctx.tenantId) return NextResponse.json({ ok: false, error: { code: "NO_TENANT" } }, { status: 401 });
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    return NextResponse.json({ ok: true, data: await createMyRequest(ctx.tenantId, ctx.userId, { regime: String(body.regime ?? ""), requestType: String(body.requestType ?? ""), description: typeof body.description === "string" ? body.description : undefined }) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
