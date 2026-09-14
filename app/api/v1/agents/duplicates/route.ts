import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listDuplicateCandidates } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import type { DuplicateCandidate } from "@/lib/shared/types/agent-identity";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("agent.read");
    const status = request.nextUrl.searchParams.get("status") as DuplicateCandidate["status"] | null;
    const candidates = await listDuplicateCandidates(ctx.tenantId!, status ?? undefined);
    return NextResponse.json({ ok: true, data: candidates });
  } catch (err) {
    return errorResponse(err);
  }
}
