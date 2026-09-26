import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { DISCOVERY_SOURCE_KINDS, DISCOVERY_STATUSES, discoverFromIntegration, getDiscoveryCounts, listDiscoveries, submitDiscovery, type DiscoverySourceKind, type DiscoveryStatus } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

// INTEGRATION-P0-10 — application discovery.
// GET ?status &source &q &page: discoveries, paged at the database, with counts.
// POST { kind: "integration", integrationId } discovers a connector's imported
// applications; { kind: "openapi", document } | { kind: "scim", name, baseUrl,
// metadata } | { kind: "manual", name, vendor?, url?, description? } records one.
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("integration.read");
    const p = request.nextUrl.searchParams;
    const status = (DISCOVERY_STATUSES as readonly string[]).includes(p.get("status") ?? "") ? (p.get("status") as DiscoveryStatus) : undefined;
    const source = (DISCOVERY_SOURCE_KINDS as readonly string[]).includes(p.get("source") ?? "") ? (p.get("source") as DiscoverySourceKind) : undefined;
    const [list, counts] = await Promise.all([
      listDiscoveries(ctx.tenantId!, { status, source, q: p.get("q") ?? undefined, page: Number(p.get("page")) || 1, pageSize: Number(p.get("pageSize")) || 50 }),
      getDiscoveryCounts(ctx.tenantId!),
    ]);
    return NextResponse.json({ ok: true, data: list.rows, meta: { total: list.total, counts } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("integration.update");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (body.kind === "integration") {
      return NextResponse.json({ ok: true, data: await discoverFromIntegration(ctx.tenantId!, ctx.userId, body.integrationId) }, { status: 201 });
    }
    const { discovery, created } = await submitDiscovery(ctx.tenantId!, ctx.userId, body);
    return NextResponse.json({ ok: true, data: discovery, meta: { created } }, { status: created ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
