import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { getTenantConfig, updateTenantConfig } from "@/lib/config/tenantConfig";

const VIEW = ["tenant.settings", "tenant.security.manage"];

/** FOUNDATION-P0-31 — Global Configuration over the API: the organization's current settings, by key. */
export async function GET() {
  try {
    const ctx = await requireAnyPermission(VIEW);
    return NextResponse.json({ ok: true, data: await getTenantConfig(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PATCH { "<setting key>": value, … } saves the changed settings as a new
 * version, as the console does: each setting needs its own permission and
 * any invalid value refuses the whole save (nothing part-applied).
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireAnyPermission(VIEW);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Send an object of setting keys and values" } }, { status: 400 });
    const result = await updateTenantConfig(ctx.tenantId!, { userId: ctx.userId, permissions: ctx.permissions, aal: ctx.aal }, body as Record<string, unknown>);
    if (!result.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: result.message, fields: result.errors } }, { status: result.errors ? 400 : 409 });
    return NextResponse.json({ ok: true, data: { version: result.version, changes: result.changes } });
  } catch (err) {
    return errorResponse(err);
  }
}
