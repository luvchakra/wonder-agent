import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { createAutomationCredential, listAutomationCredentials, type CreateInput } from "@/lib/security/automationCredentials";

/**
 * FOUNDATION-P0-31 — automation credentials for the administration API.
 * GET lists them; POST { name, identityId, roles[], expiresInDays?,
 * allowedCidrs?, rateLimitPerMinute? } creates a pending one and returns
 * its secret once. It works after someone else approves it
 * (POST /api/v1/automation-credentials/{id} { action: "approve" }).
 */
export async function GET() {
  try {
    const ctx = await requirePermission("automation.manage");
    return NextResponse.json({ ok: true, data: await listAutomationCredentials(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("automation.manage");
    const body = ((await request.json().catch(() => null)) ?? {}) as CreateInput;
    const { credential, secret } = await createAutomationCredential(ctx.tenantId!, { userId: ctx.userId, permissions: ctx.permissions }, body);
    return NextResponse.json({ ok: true, data: { credential, secret } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
