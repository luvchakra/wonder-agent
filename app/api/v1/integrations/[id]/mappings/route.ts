import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createMapping, listMappings } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { id } = await params;
    const objectType = new URL(request.url).searchParams.get("objectType") ?? undefined;
    const mappings = await listMappings(id, ctx.tenantId!, objectType);
    return NextResponse.json({ ok: true, data: mappings });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { id } = await params;
    const body = await request.json();
    const mapping = await createMapping(ctx.tenantId!, id, body.objectType, body.sourceField, body.targetField);
    return NextResponse.json({ ok: true, data: mapping }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
