import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ingestRuntimeEvent, listRuntimeEvents, quarantineEvent } from "@/modules/runtime-assurance/service";
import { errorResponse } from "@/modules/runtime-assurance/http";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RuntimeEventInput, RuntimeEventSource } from "@/lib/shared/types/runtime";

const VALID_SOURCES: RuntimeEventSource[] = ["mcp", "rest", "webhook"];

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
        agentId: typeof body.agentId === "string" ? body.agentId : null,
        source: typeof body.source === "string" ? body.source : null,
        action: typeof body.action === "string" ? body.action : null,
        submittedEventTime: typeof body.eventTime === "string" ? body.eventTime : null,
        attemptedDedupeKey: typeof body.dedupeKey === "string" ? body.dedupeKey : null,
      });
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: shapeError } }, { status: 400 });
    }

    const input: RuntimeEventInput = {
      agentId: body.agentId,
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
      correlationId: body.correlationId ?? null,
      dedupeKey: body.dedupeKey,
    };

    try {
      const { event, deduped } = await ingestRuntimeEvent(ctx.tenantId!, ctx.userId, input);
      return NextResponse.json({ ok: true, data: event, deduped });
    } catch (err) {
      if (err instanceof ApiError && err.code === "REPLAY_WINDOW_VIOLATION") {
        await quarantineEvent(ctx.tenantId!, err.code, {
          agentId: input.agentId,
          source: input.source,
          action: input.action,
          submittedEventTime: input.eventTime,
          attemptedDedupeKey: input.dedupeKey ?? null,
        });
      }
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}

function validateShape(body: Record<string, unknown>): string | null {
  if (!body.agentId || typeof body.agentId !== "string") return "agentId is required";
  if (!body.eventTime || typeof body.eventTime !== "string") return "eventTime is required";
  if (!VALID_SOURCES.includes(body.source as RuntimeEventSource)) return "source must be one of mcp, rest, webhook";
  if (!body.action || typeof body.action !== "string") return "action is required";
  if (typeof body.success !== "boolean") return "success (boolean) is required";
  return null;
}
