import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createContractVersion, listContractVersions } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

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
    const ctx = await requirePermission("agent.update");
    const { id } = await params;
    const body = await request.json();
    const contract = await createContractVersion(ctx.tenantId!, id, ctx.userId, body);
    return NextResponse.json({ ok: true, data: contract }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
