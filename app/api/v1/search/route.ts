import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { ApiError } from "@/lib/shared/types/foundation";
import { search } from "@/modules/operations/service";
import { errorResponse } from "@/modules/operations/http";

/**
 * OPERATIONS-P0-03.1 — no single blanket permission gates search itself;
 * each object type is included only if the caller holds that type's own
 * read permission (checked inside search()), same as the story's own
 * acceptance test requires.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantContext();
    if (!ctx.tenantId) throw new ApiError(401, "NO_TENANT", "No active tenant membership");
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const results = await search(ctx.tenantId, ctx.permissions, query);
    return NextResponse.json({ ok: true, data: results });
  } catch (err) {
    return errorResponse(err);
  }
}
