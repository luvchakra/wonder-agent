import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { confirmDistinctAndRegister, mergeDuplicateCandidate } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import { ApiError } from "@/lib/shared/types/foundation";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.create");
    const { id } = await params;
    const body = (await request.json()) as { decision?: "merge" | "confirm_distinct" };
    if (body.decision === "merge") {
      await mergeDuplicateCandidate(ctx.tenantId!, ctx.userId, id);
      return NextResponse.json({ ok: true, data: { status: "merged" } });
    }
    if (body.decision === "confirm_distinct") {
      const agent = await confirmDistinctAndRegister(ctx.tenantId!, ctx.userId, id);
      return NextResponse.json({ ok: true, data: agent }, { status: 201 });
    }
    throw new ApiError(400, "INVALID_DECISION", "decision must be 'merge' or 'confirm_distinct'");
  } catch (err) {
    return errorResponse(err);
  }
}
