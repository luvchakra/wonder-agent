import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createSsoConnection, listSsoConnections } from "@/lib/auth/sso";
import { errorResponse } from "@/lib/shared/apiError";
import type { SsoConnectionInput } from "@/lib/shared/types/foundation";

export async function GET() {
  try {
    const ctx = await requirePermission("sso.manage");
    const connections = await listSsoConnections(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: connections });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("sso.manage");
    const body = (await request.json()) as SsoConnectionInput;
    const connection = await createSsoConnection(ctx.tenantId!, ctx.userId, body);
    return NextResponse.json({ ok: true, data: connection }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
