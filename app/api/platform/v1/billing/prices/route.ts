import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { errorResponse } from "@/modules/platform-admin/http";
import { assertNonEmptyString, assertPlainObject } from "@/lib/security/validate";
import { listAllPrices, updatePrice } from "@/modules/billing/adjustments";

export async function GET() {
  try {
    await requirePlatformAdmin();
    return NextResponse.json({ ok: true, data: await listAllPrices() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    await updatePrice(userId, assertNonEmptyString(body.id, "id", { maxLength: 60 }), {
      unitAmount: typeof body.unitAmount === "number" ? body.unitAmount : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    return NextResponse.json({ ok: true, data: await listAllPrices() });
  } catch (err) {
    return errorResponse(err);
  }
}
