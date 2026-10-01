import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertOneOf, assertPlainObject, assertUuid } from "@/lib/security/validate";
import { advanceRequest, getRequest, type RequestAction } from "@/modules/privacy/service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("privacy.view");
    const req = await getRequest(ctx.tenantId!, assertUuid((await params).id, "id"));
    if (!req) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: req });
  } catch (err) {
    return errorResponse(err);
  }
}

/** One workflow step: verify, assign, extend, submit_for_approval, approve, return_to_processing, complete, reject. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("privacy.requests.process");
    const id = assertUuid((await params).id, "id");
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    assertOneOf(body.action, ["verify", "assign", "extend", "submit_for_approval", "approve", "return_to_processing", "complete", "reject"] as const, "action");
    return NextResponse.json({ ok: true, data: await advanceRequest(ctx.tenantId!, ctx.userId, id, body as unknown as RequestAction) });
  } catch (err) {
    return errorResponse(err);
  }
}
