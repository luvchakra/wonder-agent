import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createControlMapping, listControlMappings } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

export async function GET() {
  try {
    const ctx = await requirePermission("compliance.read");
    const mappings = await listControlMappings(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: mappings });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const body = await request.json();
    if (!body.controlId || typeof body.controlId !== "string") {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "controlId is required" } }, { status: 400 });
    }
    const mapping = await createControlMapping(ctx.tenantId!, ctx.userId, body.controlId, body.policyId, body.ownerId);
    return NextResponse.json({ ok: true, data: mapping });
  } catch (err) {
    return errorResponse(err);
  }
}
