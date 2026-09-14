import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listPolicyVersions } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-05
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("policy.read");
    const { id } = await params;
    const versions = await listPolicyVersions(id);
    return NextResponse.json({ ok: true, data: versions });
  } catch (err) {
    return errorResponse(err);
  }
}
