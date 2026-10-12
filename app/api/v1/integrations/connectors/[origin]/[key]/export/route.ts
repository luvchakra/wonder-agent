import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getConnectorDefinition } from "@/modules/integrations/framework/catalog";
import { errorResponse } from "@/modules/integrations/http";

/**
 * INTEGRATION-P0-21: a connection type as a file (the latest version, or
 * ?version=). A definition holds no secret values (only `{secret.…}`
 * references), so the file can be shared and imported elsewhere.
 */
export async function GET(request: Request, { params }: { params: Promise<{ origin: string; key: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { origin, key } = await params;
    if (origin !== "builtin" && origin !== "custom") throw new ApiError(404, "DEFINITION_NOT_FOUND");
    const version = new URL(request.url).searchParams.get("version") ?? undefined;
    const definition = await getConnectorDefinition(ctx.tenantId!, origin, key, version);
    if (!definition) throw new ApiError(404, "DEFINITION_NOT_FOUND");
    const filename = `${definition.key}-${definition.version}.json`.replace(/[^a-zA-Z0-9._-]/g, "_");
    return new NextResponse(`${JSON.stringify(definition, null, 2)}\n`, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
