import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { errorResponse } from "@/modules/platform-admin/http";
import { assertUuid } from "@/lib/security/validate";
import { listWebhookEvents } from "@/modules/billing/adjustments";

/** The webhook intake log (no payloads), for reconciliation and support. */
export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    return NextResponse.json({ ok: true, data: await listWebhookEvents({ tenantId: tenantId ? assertUuid(tenantId, "tenantId") : undefined, status }) });
  } catch (err) {
    return errorResponse(err);
  }
}
