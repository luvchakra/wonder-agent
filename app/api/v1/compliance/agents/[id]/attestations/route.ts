import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { recordAttestation, listAttestationsForAgent } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";
import type { AttestationDecision } from "@/lib/shared/types/compliance";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.read");
    const { id } = await params;
    const attestations = await listAttestationsForAgent(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: attestations });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const { id } = await params;
    const body = await request.json();
    if (!body.policyRequirement || typeof body.policyRequirement !== "string") {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "policyRequirement is required" } }, { status: 400 });
    }
    if (!body.decision) {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "decision is required" } }, { status: 400 });
    }
    const attestation = await recordAttestation(ctx.tenantId!, ctx.userId, id, {
      policyRequirement: body.policyRequirement,
      checklist: Array.isArray(body.checklist) ? body.checklist : [],
      decision: body.decision as AttestationDecision,
      comments: body.comments,
      evidenceReferences: Array.isArray(body.evidenceReferences) ? body.evidenceReferences : [],
      validUntil: body.validUntil,
    });
    return NextResponse.json({ ok: true, data: attestation });
  } catch (err) {
    return errorResponse(err);
  }
}
