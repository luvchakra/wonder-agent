import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { answerConsultation } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";
import { refuseAutomationCaller } from "@/lib/security/automationCredentials";

/**
 * COMPLIANCE-P0-14 part 3: the member asked answers, once. Any signed-in
 * member of the organization reaches this route; the service accepts only
 * the person the question was put to (anyone else: 404).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantContext();
    if (!ctx.tenantId) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    await refuseAutomationCaller("Answering an access review question");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await answerConsultation(ctx.tenantId, ctx.userId, id, body.answer) });
  } catch (err) {
    return errorResponse(err);
  }
}
