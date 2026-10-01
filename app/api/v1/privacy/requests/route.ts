import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertPlainObject } from "@/lib/security/validate";
import { createRequest, listRequests } from "@/modules/privacy/service";

/** Data-subject / data-principal requests, soonest due first (?status, ?open=1, ?limit, ?offset). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("privacy.view");
    const sp = request.nextUrl.searchParams;
    return NextResponse.json({
      ok: true,
      data: await listRequests(ctx.tenantId!, { status: sp.get("status") ?? undefined, open: sp.get("open") === "1", limit: Number(sp.get("limit") ?? 50) || 50, offset: Number(sp.get("offset") ?? 0) || 0 }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Log a request received outside WonderID (email, form, phone, post). The deadline runs from receivedAt. */
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("privacy.requests.process");
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    return NextResponse.json({ ok: true, data: await createRequest(ctx.tenantId!, ctx.userId, body as never) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
