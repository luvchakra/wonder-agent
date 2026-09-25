import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { ingestRuntimeEventByReference, quarantineEvent } from "@/modules/runtime-assurance/service";
import { getDecryptedCredential } from "./credentials";
import type { NormalizedRuntimeEvent } from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-04.2 (higher bar) + INTEGRATION-P0-07 (codebase-map D6,
 * master P0-18). Authenticates MCP proxy/observation submissions with the
 * integration's stored shared secret (same mechanism as webhooks.ts) as a
 * bearer token, compared in constant time — never accepts unauthenticated
 * event ingestion.
 *
 * Each accepted event is:
 * 1. buffered in integration_objects (object_type 'activity') as the
 *    integration's own evidence record, as before; then
 * 2. bridged into Runtime's `runtime_events` through Runtime's published
 *    `ingestRuntimeEventByReference()`, so it counts toward DID, the
 *    SHOULD/CAN/DID comparison and risk. Runtime applies its own dedupe,
 *    replay window, monitoring flag and agent resolution (the event's
 *    `agentIdentityRef` is resolved by Identity by exact identifier).
 *
 * The tenant is always the integration's, never anything in the event
 * (§14). The response states what actually happened to the event at
 * runtime (§17.5): recorded, a duplicate, or quarantined and why. It never
 * implies an event was recorded when it was quarantined.
 */
export type McpRuntimeOutcome =
  | "recorded"
  | "duplicate"
  | "quarantined_unregistered_agent"
  | "quarantined_ambiguous_agent"
  | "quarantined_replay_window"
  | "quarantined_missing_agent_reference"
  | "monitoring_disabled";

export type McpEventResult =
  | { ok: true; runtime: McpRuntimeOutcome }
  | { ok: false; status: 400 | 401 | 404 | 500; reason: string };

const MAX_FIELD = 200;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Validates the untrusted body at the boundary; unknown fields are dropped. */
export function parseMcpEvent(raw: unknown): NormalizedRuntimeEvent | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "body must be a JSON object";
  const b = raw as Record<string, unknown>;
  const str = (key: string, required: boolean): string | undefined | null => {
    const v = b[key];
    if (v === undefined || v === null || v === "") return required ? null : undefined;
    if (typeof v !== "string" || v.length > MAX_FIELD) return null;
    return v;
  };
  const fields = {
    externalId: str("externalId", false),
    agentIdentityRef: str("agentIdentityRef", false),
    eventTime: str("eventTime", true),
    tool: str("tool", false),
    application: str("application", false),
    resource: str("resource", false),
    action: str("action", true),
    dataClassification: str("dataClassification", false),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) return `${key}: required, or not a string of at most ${MAX_FIELD} characters`;
  }
  if (Number.isNaN(Date.parse(fields.eventTime as string))) return "eventTime: must be an ISO timestamp";
  if (typeof b.success !== "boolean") return "success: must be a boolean";
  return {
    externalId: fields.externalId ?? "",
    agentIdentityRef: fields.agentIdentityRef ?? undefined,
    eventTime: fields.eventTime as string,
    // This is the MCP endpoint: the source is MCP whatever the body says.
    source: "mcp",
    tool: fields.tool ?? undefined,
    application: fields.application ?? undefined,
    resource: fields.resource ?? undefined,
    action: fields.action as string,
    dataClassification: fields.dataClassification ?? undefined,
    success: b.success,
  };
}

const OUTCOME_FOR_CODE: Record<string, McpRuntimeOutcome> = {
  AGENT_NOT_REGISTERED: "quarantined_unregistered_agent",
  AGENT_REFERENCE_AMBIGUOUS: "quarantined_ambiguous_agent",
  REPLAY_WINDOW_VIOLATION: "quarantined_replay_window",
  FEATURE_DISABLED: "monitoring_disabled",
};

async function bridgeToRuntime(
  integration: { id: string; tenant_id: string; name: string },
  event: NormalizedRuntimeEvent,
  externalId: string,
): Promise<McpRuntimeOutcome> {
  if (!event.agentIdentityRef) {
    await quarantineEvent(integration.tenant_id, "MISSING_AGENT_REFERENCE", {
      source: "mcp",
      action: event.action,
      application: event.application ?? null,
      tool: event.tool ?? null,
      submittedEventTime: event.eventTime,
    });
    return "quarantined_missing_agent_reference";
  }
  try {
    const { deduped } = await ingestRuntimeEventByReference(integration.tenant_id, null, event.agentIdentityRef, {
      eventTime: event.eventTime,
      source: "mcp",
      tool: event.tool ?? null,
      application: event.application ?? null,
      resource: event.resource ?? null,
      action: event.action,
      dataClassification: event.dataClassification ?? null,
      success: event.success,
      raw: { integrationId: integration.id, externalId },
      mcpServer: integration.name,
      // A redelivery of the same MCP event maps to the same runtime event.
      dedupeKey: `mcp:${integration.id}:${externalId}`,
    });
    return deduped ? "duplicate" : "recorded";
  } catch (err) {
    const outcome = err instanceof ApiError ? OUTCOME_FOR_CODE[err.code] : undefined;
    if (outcome) return outcome;
    throw err;
  }
}

export async function ingestMcpRuntimeEvent(integrationId: string, bearerToken: string | null, rawEvent: unknown): Promise<McpEventResult> {
  if (!bearerToken) {
    return { ok: false, status: 401, reason: "Missing bearer token" };
  }
  if (!/^[0-9a-f-]{36}$/i.test(integrationId)) {
    return { ok: false, status: 404, reason: "Integration not found" };
  }

  const supabase = supabaseServiceRole();
  const { data: integration, error } = await supabase
    .from("integrations")
    .select("id, tenant_id, name")
    .eq("id", integrationId)
    .maybeSingle<{ id: string; tenant_id: string; name: string }>();
  if (error || !integration) {
    return { ok: false, status: 404, reason: "Integration not found" };
  }

  const secret = await getDecryptedCredential(integration.tenant_id, integration.id);
  if (!secret || !safeEqual(secret, bearerToken)) {
    return { ok: false, status: 401, reason: "Invalid bearer token" };
  }

  // Authenticated first, then validated: an unauthenticated caller learns
  // nothing about the expected shape.
  const event = parseMcpEvent(rawEvent);
  if (typeof event === "string") {
    return { ok: false, status: 400, reason: event };
  }

  const externalId = event.externalId || randomUUID();
  const { error: insertError } = await supabase.from("integration_objects").upsert(
    {
      tenant_id: integration.tenant_id,
      integration_id: integration.id,
      object_type: "activity",
      external_id: externalId,
      raw: event as unknown as Record<string, unknown>,
      normalized: event as unknown as Record<string, unknown>,
    },
    { onConflict: "integration_id,object_type,external_id" },
  );
  if (insertError) {
    console.error("ingestMcpRuntimeEvent failed to buffer the event", { integrationId, error: insertError.message });
    return { ok: false, status: 500, reason: "The event could not be stored" };
  }

  let runtime: McpRuntimeOutcome;
  try {
    runtime = await bridgeToRuntime(integration, event, externalId);
  } catch (err) {
    console.error("ingestMcpRuntimeEvent failed to bridge the event", { integrationId, err });
    return { ok: false, status: 500, reason: "The event was stored but could not be recorded as runtime activity; retry it" };
  }

  await writeAudit({
    tenantId: integration.tenant_id,
    actorType: "integration",
    action: "integration.mcp_event_ingested",
    objectType: "integration",
    objectId: integration.id,
    outcome: "success",
    metadata: { externalId, action: event.action, application: event.application, runtime },
  });

  return { ok: true, runtime };
}
