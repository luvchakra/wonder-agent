import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { unlinkSourceRecord } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

// WID-H01: unlink one of this source's records from its identity, with undo
// ({ externalId }). It changes an identity, so it needs identity.manage.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { sourceId } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as { externalId?: unknown };
    return NextResponse.json({ ok: true, data: await unlinkSourceRecord(ctx.tenantId!, ctx.userId, sourceId, body.externalId) });
  } catch (err) {
    return errorResponse(err);
  }
}
