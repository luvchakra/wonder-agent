import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createApplication, listApplications } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function GET() {
  try {
    const ctx = await requirePermission("access.read");
    const apps = await listApplications(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: apps });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("access.manage");
    const body = await request.json();
    const app = await createApplication(ctx.tenantId!, body.name, body.category, body.sourceIntegrationId);
    return NextResponse.json({ ok: true, data: app }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
