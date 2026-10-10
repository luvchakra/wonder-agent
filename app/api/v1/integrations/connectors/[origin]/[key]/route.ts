import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getConnectorDefinition, listCustomDefinitionVersions } from "@/modules/integrations/framework/catalog";
import { errorResponse } from "@/modules/integrations/http";

/** One definition in full (the latest version, or ?version=), with this organization's versions of its own. */
export async function GET(request: Request, { params }: { params: Promise<{ origin: string; key: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { origin, key } = await params;
    if (origin !== "builtin" && origin !== "custom") throw new ApiError(404, "DEFINITION_NOT_FOUND");
    const version = new URL(request.url).searchParams.get("version") ?? undefined;
    const definition = await getConnectorDefinition(ctx.tenantId!, origin, key, version);
    if (!definition) throw new ApiError(404, "DEFINITION_NOT_FOUND");
    const versions = origin === "custom" ? await listCustomDefinitionVersions(ctx.tenantId!, key) : [];
    return NextResponse.json({ ok: true, data: { origin, definition, versions } });
  } catch (err) {
    return errorResponse(err);
  }
}
