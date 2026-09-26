import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createContractVersion, listContractVersions } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import { requirePermissionFor } from "@/lib/rbac/authorize";
import { agentResource } from "@/app/_shared/agentScope";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.read");
    const { id } = await params;
    const contracts = await listContractVersions(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: contracts });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermissionFor("agent.update", agentResource(id));
    const body = await request.json();
    const contract = await createContractVersion(ctx.tenantId!, id, ctx.userId, body);
    return NextResponse.json({ ok: true, data: contract }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
