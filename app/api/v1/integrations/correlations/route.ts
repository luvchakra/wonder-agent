import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listPendingCorrelations } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

// INTEGRATION-P0-09 — ambiguous source matches waiting for a person.
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("integration.read");
    const status = request.nextUrl.searchParams.get("status");
    const allowed = ["pending", "linked", "created", "dismissed"] as const;
    return NextResponse.json({
      ok: true,
      data: await listPendingCorrelations(ctx.tenantId!, {
        status: (allowed as readonly string[]).includes(status ?? "") ? (status as (typeof allowed)[number]) : "pending",
        sourceId: request.nextUrl.searchParams.get("sourceId") ?? undefined,
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
