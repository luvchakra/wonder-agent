import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { decideDiscovery, getDiscovery, type DiscoveryDecision } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

// INTEGRATION-P0-10 — one discovery (GET) and a person's decision on it
// (POST { action: register | link | exception | ignore | reopen, note,
// applicationId, exceptionUntil, application, connect }). Registering or
// linking also changes the catalog, so it needs access.manage too.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { id } = await params;
    const d = await getDiscovery(ctx.tenantId!, id);
    if (!d) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No such discovery" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: d });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as DiscoveryDecision;
    if (body.action === "register" || body.action === "link") await requirePermission("access.manage");
    return NextResponse.json({ ok: true, data: await decideDiscovery(ctx.tenantId!, ctx.userId, id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
