import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listReconciliationRuns, reconcileApplicationAccounts } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-17 — account reconciliation runs for one application (GET) and
// a new run (POST) under the configuration onboarding promoted. A run
// reads the connector's imported accounts; nothing in the connected
// system changes.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await listReconciliationRuns(ctx.tenantId!, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await reconcileApplicationAccounts(ctx.tenantId!, ctx.userId, id) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
