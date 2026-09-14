import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { addControlEvidence, listControlEvidence } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";
import type { ControlEvidenceType, ControlStatus } from "@/lib/shared/types/compliance";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.read");
    const { id } = await params;
    const evidence = await listControlEvidence(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: evidence });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const { id } = await params;
    const body = await request.json();
    const result = await addControlEvidence(
      ctx.tenantId!,
      ctx.userId,
      id,
      body.evidenceType as ControlEvidenceType,
      String(body.summary ?? ""),
      body.referenceId,
      body.manualStatus as ControlStatus | undefined,
    );
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return errorResponse(err);
  }
}
