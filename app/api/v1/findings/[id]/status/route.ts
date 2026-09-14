import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { transitionFindingStatus } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";
import type { FindingStatus } from "@/lib/shared/types/risk";

const ALLOWED: FindingStatus[] = ["acknowledged", "investigating", "mitigated", "exception"];

/** RISK-P0-03.4 — the finer-grained lifecycle transitions beyond assign/remediate/resolve. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = await request.json();
    const status = body.status as FindingStatus;
    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: `status must be one of ${ALLOWED.join(", ")}` } }, { status: 400 });
    }
    const finding = await transitionFindingStatus(ctx.tenantId!, ctx.userId, id, status);
    return NextResponse.json({ ok: true, data: finding });
  } catch (err) {
    return errorResponse(err);
  }
}
