import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ingestRuntimeEventByReference, listRuntimeEvents, quarantineEvent } from "@/modules/runtime-assurance/service";
import { errorResponse } from "@/modules/runtime-assurance/http";
import { RUNTIME_EVENT_TYPES, type RuntimeEventSource, type RuntimeEventType } from "@/lib/shared/types/runtime";

// "gateway" is deliberately absent: only the Runtime Gateway itself writes
// gateway events (RUNTIME-P0-16); a client may not claim that source.
const VALID_SOURCES: RuntimeEventSource[] = ["mcp", "rest", "webhook"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RUNTIME-P0-01.3 timeline query. Client-facing, gated by runtime.read —
 * runtime_events grants a client SELECT policy (migration 0032).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("runtime.read");
    const params = request.nextUrl.searchParams;
    const page = await listRuntimeEvents(ctx.tenantId!, {
      agentId: params.get("agentId") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      cursor: params.get("cursor") ?? undefined,
    });
    return NextResponse.json({ ok: true, data: page.events, nextCursor: page.nextCursor });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * RUNTIME-P0-01.1/01.2. This is Runtime Agent's own direct ingestion
 * endpoint, per the backlog's explicit allowance ("Runtime Agent may still
 * build its own direct ingestion endpoint for MCP/REST events... do not
 * block core event-model stories on Integration").
 *
 * Authentication decision, flagged rather than silently assumed: this
 * route is gated by the standard requirePermission('runtime.ingest')
 * tenant-scoped RBAC path (the same authenticated-session model every
 * other write endpoint in this codebase uses) rather than a new
 * shared-secret/bearer-token mechanism like Integration Agent's MCP/webhook
 * endpoints. Integration Agent owns integration credential/shared-secret
 * infrastructure (docs/design/ownership-map.md); inventing a second one
 * here would duplicate that ownership (non-negotiable #6/#14). A dedicated
 * machine-to-machine ingestion token, if a real MCP proxy deployment needs
 * one, is Foundation's or Integration's to design — recorded in the audit
 * log rather than decided unilaterally here.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("runtime.ingest");
    const body = await request.json();

    // RUNTIME-P0-11 — a shape-invalid submission is quarantined (a safe,
    // queryable record) rather than silently dropped with a bare 400, so
    // an administrator can investigate a misbehaving source.
    const shapeError = validateShape(body);
    if (shapeError) {
      await quarantineEvent(ctx.tenantId!, shapeError, {
        agentId: null,
        observedAgentRef: typeof body.agentId === "string" ? body.agentId : typeof body.agentRef === "string" ? body.agentRef : null,
        source: typeof body.source === "string" ? body.source : null,
        action: typeof body.action === "string" ? body.action : null,
        submittedEventTime: typeof body.eventTime === "string" ? body.eventTime : null,
        attemptedDedupeKey: typeof body.dedupeKey === "string" ? body.dedupeKey : null,
      });
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: shapeError } }, { status: 400 });
    }

    // IDENTITY-P0-12: the agent is named by its WonderAgent id or by an
    // external reference (a linked identity's id in the source system).
    // Runtime resolves it through Identity by exact identifier only; an
    // unregistered agent's event is quarantined as Shadow AI evidence and
    // an ambiguous one for review. Neither is recorded as runtime activity.
    const { event, deduped } = await ingestRuntimeEventByReference(ctx.tenantId!, ctx.userId, body.agentId ?? body.agentRef, {
      identityId: body.identityId ?? null,
      eventTime: body.eventTime,
      source: body.source,
      tool: body.tool ?? null,
      application: body.application ?? null,
      resource: body.resource ?? null,
      action: body.action,
      dataClassification: body.dataClassification ?? null,
      success: body.success,
      raw: body.raw ?? {},
      eventType: body.eventType,
      sessionId: body.sessionId ?? null,
      mcpServer: body.mcpServer ?? null,
      correlationId: body.correlationId ?? null,
      dedupeKey: body.dedupeKey,
    });
    return NextResponse.json({ ok: true, data: event, deduped });
  } catch (err) {
    return errorResponse(err);
  }
}

function validateShape(body: Record<string, unknown>): string | null {
  const hasId = typeof body.agentId === "string" && body.agentId.length > 0;
  const hasRef = typeof body.agentRef === "string" && body.agentRef.trim().length > 0;
  if (!hasId && !hasRef) return "agentId or agentRef is required";
  if (hasId && hasRef) return "send agentId or agentRef, not both";
  if (hasRef && (body.agentRef as string).length > 200) return "agentRef must be at most 200 characters";
  if (hasId && !UUID.test(body.agentId as string)) return "agentId must be a UUID";
  if (!body.eventTime || typeof body.eventTime !== "string") return "eventTime is required";
  if (!VALID_SOURCES.includes(body.source as RuntimeEventSource)) return "source must be one of mcp, rest, webhook";
  if (!body.action || typeof body.action !== "string") return "action is required";
  if (typeof body.success !== "boolean") return "success (boolean) is required";
  if (body.eventType !== undefined && !RUNTIME_EVENT_TYPES.includes(body.eventType as RuntimeEventType)) {
    return `eventType must be one of ${RUNTIME_EVENT_TYPES.join(", ")}`;
  }
  if (body.sessionId !== undefined && (typeof body.sessionId !== "string" || body.sessionId.length > 200)) return "sessionId must be a string of at most 200 characters";
  if (body.mcpServer !== undefined && (typeof body.mcpServer !== "string" || body.mcpServer.length > 200)) return "mcpServer must be a string of at most 200 characters";
  return null;
}
