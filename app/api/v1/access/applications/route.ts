import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createApplication, listApplications, registerApplication } from "@/modules/access-governance/service";
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
    const body = (await request.json().catch(() => null)) ?? {};
    // ACCESS-P0-15: a hand-registered application enters the catalog
    // (validated, owners checked, DISCOVERED). An application linked to an
    // integration keeps the original path.
    const app = body.sourceIntegrationId
      ? await createApplication(ctx.tenantId!, body.name, body.category, body.sourceIntegrationId, body.isExternal ?? false)
      : await registerApplication(ctx.tenantId!, ctx.userId, body);
    return NextResponse.json({ ok: true, data: app }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
