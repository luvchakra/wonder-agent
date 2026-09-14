import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { buildDiscoveryInbox } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

export async function GET() {
  try {
    const ctx = await requirePermission("agent.read");
    const entries = await buildDiscoveryInbox(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: entries });
  } catch (err) {
    return errorResponse(err);
  }
}
