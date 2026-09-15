import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { recordDiscoveryDecision } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AgentIdentityType } from "@/lib/shared/types/agent-identity";

/**
 * Agent Discovery — POST-only decision endpoint for client components that
 * need a `fetch()` round trip (ConfirmActionDialog's established pattern —
 * see MergeDuplicateButton) rather than a server-action form submit.
 * Server actions (app/actions/agents.ts) remain the primary path for
 * form-driven candidate review; this exists only for the confirm-dialog
 * "Ignore" flow.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("agent.create");
    const body = (await request.json()) as {
      sourceSystem?: string;
      sourceObjectId?: string;
      displayName?: string;
      decisionType?: "ignored" | "linked";
      matchedAgentId?: string;
      identityType?: AgentIdentityType;
    };
    if (!body.sourceSystem || !body.sourceObjectId || !body.decisionType) {
      throw new ApiError(400, "INVALID_INPUT", "sourceSystem, sourceObjectId and decisionType are required");
    }

    const candidate = await recordDiscoveryDecision(ctx.tenantId!, ctx.userId, {
      sourceSystem: body.sourceSystem,
      sourceObjectId: body.sourceObjectId,
      displayName: body.displayName ?? "",
      decisionType: body.decisionType,
      matchedAgentId: body.matchedAgentId,
      identityType: body.identityType,
    });
    return NextResponse.json({ ok: true, data: candidate });
  } catch (err) {
    return errorResponse(err);
  }
}
