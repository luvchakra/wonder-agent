import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { readTenantConfigStrict } from "@/lib/config/tenantConfig";
import { exportConfigBundle } from "@/lib/config/bundle";
import { getMyTenantEnvironments } from "@/lib/tenant/environments";
import { writeAudit } from "@/lib/audit/writeAudit";

const VIEW = ["tenant.settings", "tenant.security.manage"];

/**
 * PLATFORM-P0-13 — downloads the organization's Global Configuration as a
 * signed bundle, to import into another environment. The values are not
 * secret; the export is audited.
 */
export async function GET() {
  try {
    const ctx = await requireAnyPermission(VIEW);
    const tenantId = ctx.tenantId!;
    const [config, environments] = await Promise.all([readTenantConfigStrict(tenantId), getMyTenantEnvironments()]);
    const bundle = exportConfigBundle(config, { organization: ctx.tenantSlug ?? "organization", environment: environments.get(tenantId)?.environment ?? null });
    if (!bundle) return NextResponse.json({ ok: false, error: { code: "NOT_CONFIGURED", message: "Configuration files can't be signed on this server." } }, { status: 503 });
    await writeAudit({ tenantId, actorId: ctx.userId, actorType: "user", action: "tenant.config_exported", objectType: "tenant_config", objectId: tenantId, outcome: "success", metadata: { exportedAt: bundle.exportedAt } });
    const name = `wonderid-configuration-${bundle.source.organization}-${bundle.exportedAt.slice(0, 10)}.json`.replace(/[^A-Za-z0-9._-]/g, "-");
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
