import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { askConsultation, listConsultationsForItem } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";
import { refuseAutomationCaller } from "@/lib/security/automationCredentials";

/** COMPLIANCE-P0-14 part 3: the questions on one review item; the item's reviewer asks one. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.read");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await listConsultationsForItem(ctx.tenantId!, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.read");
    await refuseAutomationCaller("Consulting on an access review");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const consultation = await askConsultation(ctx.tenantId!, ctx.userId, id, { askedOfUserId: body.askedOfUserId, askedOfEmail: body.askedOfEmail, question: body.question });
    return NextResponse.json({ ok: true, data: consultation }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
