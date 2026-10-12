import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { validateTerms } from "@/lib/rbac/assignmentRules";
import {
  approveAutomationCredential,
  approveAutomationCredentialExtension,
  assignAutomationCredentialRole,
  removeAutomationCredentialRole,
  requestAutomationCredentialExtension,
  revokeAutomationCredential,
  rotateAutomationCredential,
} from "@/lib/security/automationCredentials";

type Body = { action?: unknown; days?: unknown; reason?: unknown; role?: unknown; scopeType?: unknown; scopeValues?: unknown; startsAt?: unknown; expiresAt?: unknown };

/**
 * FOUNDATION-P0-31 — one credential's actions, POST { action, … }:
 * approve (not by its creator), request_extension { days },
 * approve_extension (not by the requester), revoke { reason }, rotate
 * (returns the new secret once), assign_role { role, scope terms? },
 * remove_role { role }. Each is audited by the service.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("automation.manage");
    const tenantId = ctx.tenantId!;
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Body;
    switch (body.action) {
      case "approve":
        await approveAutomationCredential(tenantId, ctx.userId, id);
        break;
      case "request_extension":
        await requestAutomationCredentialExtension(tenantId, ctx.userId, id, body.days);
        break;
      case "approve_extension":
        await approveAutomationCredentialExtension(tenantId, ctx.userId, id);
        break;
      case "revoke":
        await revokeAutomationCredential(tenantId, ctx.userId, id, body.reason);
        break;
      case "rotate":
        return NextResponse.json({ ok: true, data: await rotateAutomationCredential(tenantId, ctx.userId, id) }, { headers: { "Cache-Control": "no-store" } });
      case "assign_role":
      case "remove_role": {
        if (typeof body.role !== "string" || !body.role) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "role is required" } }, { status: 400 });
        if (body.action === "remove_role") {
          await removeAutomationCredentialRole(tenantId, ctx.userId, id, body.role);
          break;
        }
        const terms = validateTerms(body, body.role, new Date());
        if (!terms.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid assignment terms", fields: terms.errors } }, { status: 400 });
        await assignAutomationCredentialRole(tenantId, { userId: ctx.userId, permissions: ctx.permissions }, id, body.role, terms.terms);
        break;
      }
      default:
        return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Unknown action" } }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
