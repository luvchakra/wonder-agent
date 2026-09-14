import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { createTenant, listTenants } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const tenants = await listTenants();
    return NextResponse.json({ ok: true, data: tenants });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();
    const body = await request.json();
    if (!body.name || !body.slug) {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "name and slug are required" } }, { status: 400 });
    }
    const tenant = await createTenant(userId, { name: body.name, slug: body.slug, environment: body.environment, notes: body.notes });
    return NextResponse.json({ ok: true, data: tenant });
  } catch (err) {
    return errorResponse(err);
  }
}
