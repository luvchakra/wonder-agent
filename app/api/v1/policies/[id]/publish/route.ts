import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { publishPolicy } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-12 — publish a draft (or disabled) policy so it takes effect: a new, audited version. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("policy.publish");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await publishPolicy(ctx.tenantId!, ctx.userId, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
