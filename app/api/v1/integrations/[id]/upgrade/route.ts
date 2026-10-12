import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { previewConnectionUpgrade, upgradeConnection } from "@/modules/integrations/framework/catalog";
import { errorResponse } from "@/modules/integrations/http";

/** INTEGRATION-P0-21: what moving this connection to ?version= would change (changes nothing). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { id } = await params;
    const version = new URL(request.url).searchParams.get("version") ?? "";
    return NextResponse.json({ ok: true, data: await previewConnectionUpgrade(ctx.tenantId!, id, version) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Moves this connection to { version }; refused while anything blocks it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ ok: true, data: await upgradeConnection(ctx.tenantId!, ctx.userId, id, body?.version) });
  } catch (err) {
    return errorResponse(err);
  }
}
