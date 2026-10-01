import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { errorResponse } from "@/lib/shared/apiError";
import { exportMyData } from "@/modules/privacy/service";

/** Download my data in this organization (GDPR Art. 15/20, DPDP s.11). Never cached. */
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx.tenantId) return NextResponse.json({ ok: false, error: { code: "NO_TENANT" } }, { status: 401 });
    const data = await exportMyData(ctx.tenantId, ctx.userId);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="my-wonderid-data.json"', "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
