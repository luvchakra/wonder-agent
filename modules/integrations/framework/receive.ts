import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { decryptSecret, encryptSecret } from "@/lib/security/encryptSecret";
import { bearerAgentKey, verifyAgentApiKey } from "@/lib/security/agentApiKeys";
import { ApiError } from "@/lib/shared/types/foundation";
import {
  authorizeRuntimeRequest,
  filterGatewayTools,
  ingestRuntimeEventByReference,
  parseGatewayRequest,
  quarantineEvent,
} from "@/modules/runtime-assurance/service";
import { openGateway } from "../gateway/gateway";
import { parseConnectorConfig } from "./engine";
import { readPath } from "./mapping";
import { eventRecords, mapRuntimeEvent, verifySender, type ReceivedRuntimeEvent } from "./receiveRules";
import type { ConnectorDefinition } from "./types";

/**
 * The receiving side of the connector framework: the only place an
 * organization's systems may send data to WonderID (non-negotiable #20).
 * Served at /api/connect/v1/<connection id>/<channel>.
 *
 * There is no user session here, so every query uses the service role.
 * The organization is always the connection's own (tenant_id of its
 * integrations row), never anything in the request (§14). A connection
 * that is disabled, deleted, of another type, or whose definition does not
 * declare the channel receives nothing.
 */

export type ReceiveResult = { status: number; body: Record<string, unknown> };

const fail = (status: number, code: string, message: string): ReceiveResult => ({ status, body: { ok: false, error: { code, message } } });

type Connection = { id: string; tenantId: string; name: string; status: string; def: ConnectorDefinition };

/** A connector connection by id, disabled ones included (the gateway refuses those); null when there is none. */
async function loadConnection(connectionId: string): Promise<Connection | null> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return null;
  const { data, error } = await supabaseServiceRole()
    .from("integrations")
    .select("id, tenant_id, name, status, integration_type_id, config")
    .eq("id", connectionId)
    .maybeSingle<{ id: string; tenant_id: string; name: string; status: string; integration_type_id: string; config: Record<string, unknown> }>();
  if (error) throw new ApiError(503, "UNAVAILABLE", "The connection could not be read");
  if (!data || data.integration_type_id !== "connector") return null;
  try {
    return { id: data.id, tenantId: data.tenant_id, name: data.name, status: data.status, def: parseConnectorConfig(data.config).def };
  } catch {
    return null;
  }
}

async function receiverSecret(tenantId: string, connectionId: string): Promise<string | null> {
  const { data, error } = await supabaseServiceRole()
    .from("connector_receivers")
    .select("encrypted_secret")
    .eq("integration_id", connectionId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ encrypted_secret: string }>();
  if (error) throw new ApiError(503, "UNAVAILABLE", "The connection could not be read");
  return data ? decryptSecret(data.encrypted_secret) : null;
}

async function touch(tenantId: string, connectionId: string) {
  await supabaseServiceRole().from("connector_receivers").update({ last_received_at: new Date().toISOString() }).eq("integration_id", connectionId).eq("tenant_id", tenantId);
}

/**
 * Creates or replaces a connection's receiving secret and returns it once.
 * The caller has checked integration.update for `tenantId`. A secret is
 * only issued for a connection whose definition receives something.
 */
export async function rotateReceiverSecret(tenantId: string, actorId: string, connectionId: string): Promise<string> {
  const conn = await loadConnection(connectionId);
  if (!conn || conn.tenantId !== tenantId || conn.status === "disabled") throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  const r = conn.def.receive;
  if (!r?.runtimeEvents && !r?.webhook) throw new ApiError(400, "NOT_A_RECEIVER", "This connection receives nothing that needs a secret");
  const secret = `wr_${randomBytes(32).toString("base64url")}`;
  const now = new Date().toISOString();
  const { error } = await supabaseServiceRole()
    .from("connector_receivers")
    .upsert({ integration_id: connectionId, tenant_id: tenantId, encrypted_secret: await encryptSecret(secret), rotated_at: now }, { onConflict: "integration_id" });
  if (error) throw new ApiError(500, "SAVE_FAILED", "The secret could not be saved");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "integration.receiver_secret_rotated",
    objectType: "integration",
    objectId: connectionId,
    outcome: "success",
  });
  return secret;
}

/** Whether a connection has a receiving secret, and when it last received something (never the secret). */
export async function getReceiverStatus(tenantId: string, connectionId: string): Promise<{ hasSecret: boolean; rotatedAt: string | null; lastReceivedAt: string | null }> {
  const { data } = await supabaseServiceRole()
    .from("connector_receivers")
    .select("rotated_at, created_at, last_received_at")
    .eq("integration_id", connectionId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ rotated_at: string | null; created_at: string; last_received_at: string | null }>();
  return { hasSecret: Boolean(data), rotatedAt: data?.rotated_at ?? data?.created_at ?? null, lastReceivedAt: data?.last_received_at ?? null };
}

// ---------------------------------------------------------------- runtime events

export type RuntimeOutcome =
  | "recorded"
  | "duplicate"
  | "quarantined_unregistered_agent"
  | "quarantined_ambiguous_agent"
  | "quarantined_replay_window"
  | "quarantined_missing_agent_reference"
  | "monitoring_disabled"
  | "rejected";

const OUTCOME_FOR_CODE: Record<string, RuntimeOutcome> = {
  AGENT_NOT_REGISTERED: "quarantined_unregistered_agent",
  AGENT_REFERENCE_AMBIGUOUS: "quarantined_ambiguous_agent",
  REPLAY_WINDOW_VIOLATION: "quarantined_replay_window",
  FEATURE_DISABLED: "monitoring_disabled",
};

type EventResult = { outcome: RuntimeOutcome; reason?: string; agentId?: string; eventId?: string };

async function recordEvent(conn: Connection, source: "mcp" | "rest" | "webhook", event: ReceivedRuntimeEvent): Promise<EventResult> {
  const externalId = event.externalId ?? randomUUID();
  // The connection keeps its own evidence record of what it received.
  const { error } = await supabaseServiceRole()
    .from("integration_objects")
    .upsert(
      { tenant_id: conn.tenantId, integration_id: conn.id, object_type: "activity", external_id: externalId, raw: event, normalized: event },
      { onConflict: "integration_id,object_type,external_id" },
    );
  if (error) throw new ApiError(500, "STORE_FAILED", "The event could not be stored");
  if (!event.agentIdentityRef) {
    await quarantineEvent(conn.tenantId, "MISSING_AGENT_REFERENCE", {
      source,
      action: event.action,
      application: event.application,
      tool: event.tool,
      submittedEventTime: event.eventTime,
    });
    return { outcome: "quarantined_missing_agent_reference" };
  }
  try {
    const { event: recorded, deduped } = await ingestRuntimeEventByReference(conn.tenantId, null, event.agentIdentityRef, {
      eventTime: event.eventTime,
      source,
      tool: event.tool,
      application: event.application,
      resource: event.resource,
      action: event.action,
      dataClassification: event.dataClassification,
      success: event.success,
      raw: { connectionId: conn.id, externalId },
      eventType: event.eventType ?? undefined,
      sessionId: event.sessionId,
      correlationId: event.correlationId,
      mcpServer: event.mcpServer ?? (source === "mcp" ? conn.name : null),
      // A redelivery of the same event maps to the same runtime event.
      dedupeKey: event.externalId ? `connect:${conn.id}:${event.externalId}` : undefined,
    });
    // The sender learns which agent its reference resolved to, as the old endpoint told it.
    return { outcome: deduped ? "duplicate" : "recorded", agentId: recorded.agentId, eventId: recorded.id };
  } catch (err) {
    const outcome = err instanceof ApiError ? OUTCOME_FOR_CODE[err.code] : undefined;
    if (outcome) return { outcome };
    throw err;
  }
}

async function receiveRuntimeEvents(conn: Connection, rawBody: string, headers: Headers): Promise<ReceiveResult> {
  const spec = conn.def.receive?.runtimeEvents;
  if (!spec) return fail(404, "NOT_FOUND", "This connection does not receive runtime events");
  const secret = await receiverSecret(conn.tenantId, conn.id);
  if (!secret || !verifySender(spec.auth, secret, rawBody, headers, spec.signatureHeader)) return fail(401, "UNAUTHENTICATED", "A valid connection secret is required");
  // Authenticated first: an unauthenticated sender learns nothing about the expected shape.
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, "INVALID_INPUT", "body: must be JSON");
  }
  const records = eventRecords(spec, body);
  if (typeof records === "string") return fail(400, "INVALID_INPUT", records);
  const outcomes: EventResult[] = [];
  for (const record of records) {
    const event = mapRuntimeEvent(spec, record);
    if (typeof event === "string") {
      outcomes.push({ outcome: "rejected", reason: event });
      continue;
    }
    outcomes.push(await recordEvent(conn, spec.source, event));
  }
  await touch(conn.tenantId, conn.id);
  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
  await writeAudit({
    tenantId: conn.tenantId,
    actorType: "integration",
    action: "integration.runtime_events_received",
    objectType: "integration",
    objectId: conn.id,
    outcome: counts.rejected === outcomes.length ? "failure" : "success",
    metadata: { counts, source: spec.source },
  });
  // A single event answers with its own outcome; a batch with one per event, in order.
  const single = !spec.records && !Array.isArray(body);
  if (single) {
    const [o] = outcomes;
    if (o.outcome === "rejected") return fail(400, "INVALID_INPUT", o.reason ?? "invalid event");
    return { status: 202, body: { ok: true, data: { runtime: o.outcome, ...(o.agentId ? { agentId: o.agentId, eventId: o.eventId } : {}) } } };
  }
  return { status: 202, body: { ok: true, data: { received: outcomes.length, counts, outcomes } } };
}

// ---------------------------------------------------------------- webhooks

async function receiveWebhook(conn: Connection, rawBody: string, headers: Headers): Promise<ReceiveResult> {
  const spec = conn.def.receive?.webhook;
  if (!spec) return fail(404, "NOT_FOUND", "This connection does not receive webhooks");
  const secret = await receiverSecret(conn.tenantId, conn.id);
  if (!secret || !verifySender(spec.auth, secret, rawBody, headers, spec.signatureHeader)) return fail(401, "UNAUTHENTICATED", "A valid signature is required");
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, "INVALID_INPUT", "body: must be JSON");
  }
  if (typeof body !== "object" || body === null) return fail(400, "INVALID_INPUT", "body: must be a JSON object or list");
  const id = spec.externalId ? readPath(body, spec.externalId) : undefined;
  const externalId = typeof id === "string" || typeof id === "number" ? String(id).slice(0, 300) : randomUUID();
  const { error } = await supabaseServiceRole()
    .from("integration_objects")
    .upsert(
      { tenant_id: conn.tenantId, integration_id: conn.id, object_type: "activity", external_id: externalId, raw: body, normalized: body },
      { onConflict: "integration_id,object_type,external_id" },
    );
  if (error) return fail(500, "STORE_FAILED", "The event could not be stored");
  await touch(conn.tenantId, conn.id);
  await writeAudit({
    tenantId: conn.tenantId,
    actorType: "integration",
    action: "integration.webhook_received",
    objectType: "integration",
    objectId: conn.id,
    outcome: "success",
    metadata: { externalId },
  });
  return { status: 202, body: { ok: true, data: null } };
}

// ---------------------------------------------------------------- gateway

async function receiveGateway(conn: Connection, which: "authorize" | "tools/filter", rawBody: string, headers: Headers): Promise<ReceiveResult> {
  const spec = conn.def.receive?.gateway;
  if (!spec || (which === "authorize" ? !spec.authorize : !spec.toolsFilter)) return fail(404, "NOT_FOUND", "This connection does not serve the Runtime Gateway");
  let principal;
  try {
    principal = await verifyAgentApiKey(bearerAgentKey(headers));
  } catch {
    // The key store could not be reached. That is never permission.
    return fail(503, "AUTH_UNAVAILABLE", "Agent authentication is temporarily unavailable");
  }
  // An agent of another organization is refused exactly like a bad key.
  if (!principal || principal.tenantId !== conn.tenantId) return fail(401, "UNAUTHENTICATED", "A valid agent API key is required");
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, "VALIDATION_FAILED", "body: must be valid JSON");
  }
  try {
    const data = which === "authorize" ? await authorizeRuntimeRequest(principal, parseGatewayRequest(body)) : await filterGatewayTools(principal, body);
    await touch(conn.tenantId, conn.id);
    return { status: 200, body: { ok: true, data } };
  } catch (err) {
    if (err instanceof ApiError) return fail(err.status, err.code, err.message);
    console.error("gateway request failed", { connectionId: conn.id, which });
    return fail(500, "INTERNAL_ERROR", which === "authorize" ? "The request could not be decided" : "Tool visibility could not be evaluated");
  }
}

// ---------------------------------------------------------------- entry point

export const MAX_RECEIVE_BYTES: Record<string, number> = { events: 1024 * 1024, webhook: 1024 * 1024, gateway: 16 * 1024 };

/** One received request: `channel` is events, webhook, gateway/authorize or gateway/tools/filter. */
export async function receive(connectionId: string, channel: string, rawBody: string, headers: Headers): Promise<ReceiveResult> {
  const kind = channel.startsWith("gateway/") ? "gateway" : channel;
  const limit = MAX_RECEIVE_BYTES[kind];
  if (!limit) return fail(404, "NOT_FOUND", "No such channel");
  if (Buffer.byteLength(rawBody, "utf8") > limit) return fail(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${Math.round(limit / 1024)} KB`);
  let conn: Connection | null;
  try {
    conn = await loadConnection(connectionId);
  } catch {
    return fail(503, "UNAVAILABLE", "Try again shortly");
  }
  if (!conn) return fail(404, "NOT_FOUND", "No such connection");
  // Every request a connection receives passes its Connector Gateway session,
  // which refuses a disabled connection and records the request (by channel
  // and outcome only: never the body, the sender's address or its secret).
  const gateway = openGateway({ tenantId: conn.tenantId, integrationId: conn.id, status: conn.status });
  const started = Date.now();
  const admitted = gateway.admits();
  const result = admitted ? await dispatch(conn, channel, rawBody, headers) : fail(404, "NOT_FOUND", "No such connection");
  gateway.recordInbound({
    channel,
    status: result.status,
    bytesIn: Buffer.byteLength(rawBody, "utf8"),
    bytesOut: Buffer.byteLength(JSON.stringify(result.body), "utf8"),
    durationMs: Date.now() - started,
    refusal: admitted ? undefined : "disabled",
  });
  await gateway.flush();
  return result;
}

async function dispatch(conn: Connection, channel: string, rawBody: string, headers: Headers): Promise<ReceiveResult> {
  try {
    if (channel === "events") return await receiveRuntimeEvents(conn, rawBody, headers);
    if (channel === "webhook") return await receiveWebhook(conn, rawBody, headers);
    if (channel === "gateway/authorize") return await receiveGateway(conn, "authorize", rawBody, headers);
    if (channel === "gateway/tools/filter") return await receiveGateway(conn, "tools/filter", rawBody, headers);
    return fail(404, "NOT_FOUND", "No such channel");
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) return fail(err.status, err.code, err.message);
    console.error("receive failed", { connectionId: conn.id, channel, code: err instanceof ApiError ? err.code : undefined });
    return fail(500, "INTERNAL_ERROR", "The request could not be processed; retry it");
  }
}
