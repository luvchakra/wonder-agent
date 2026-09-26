import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createOnboardingProposal, listOnboardingProposals } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

// INTEGRATION-P0-12 — onboarding proposals for one application.
// GET ?applicationId: the latest proposals.
// POST { applicationId, kind: "openapi" | "sample", text }: a new proposal.
// A proposal never activates anything (see the service).
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("integration.read");
    const applicationId = request.nextUrl.searchParams.get("applicationId") ?? "";
    return NextResponse.json({ ok: true, data: await listOnboardingProposals(ctx.tenantId!, applicationId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("integration.update");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
    return NextResponse.json({ ok: true, data: await createOnboardingProposal(ctx.tenantId!, ctx.userId, applicationId, { kind: body.kind, text: body.text }) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
