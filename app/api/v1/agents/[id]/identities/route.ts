import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { linkAgentIdentity, listAgentIdentities } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.read");
    const { id } = await params;
    const identities = await listAgentIdentities(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: identities });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.update");
    const { id } = await params;
    const body = await request.json();
    const link = await linkAgentIdentity(
      ctx.tenantId!,
      id,
      body.identityType,
      body.externalReference,
      body.sourceSystem,
    );
    return NextResponse.json({ ok: true, data: link }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
