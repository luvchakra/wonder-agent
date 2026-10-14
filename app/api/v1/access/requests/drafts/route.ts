import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listRequestDrafts, saveRequestDraft } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-38 part 2 — the caller's own saved baskets.
export async function GET() {
  try {
    const ctx = await requirePermission("access.request");
    return NextResponse.json({ ok: true, data: await listRequestDrafts(ctx.tenantId!, ctx.userId) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `{ name, payload: { subjectIdentityIds, items: ["<app>|<entitlement>"], justification } }`; sends nothing. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.request");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await saveRequestDraft(ctx.tenantId!, ctx.userId, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
