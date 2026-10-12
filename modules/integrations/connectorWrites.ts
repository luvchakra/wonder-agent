import "server-only";

import type { ConnectorAdapter } from "./connector";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ConnectorCapabilities, ConnectorWriteResult } from "@/lib/shared/types/integrations";
import { createConnector } from "./registry";
import { openGateway } from "./gateway/gateway";
import { getDecryptedCredential, keepObtainedTokens } from "./credentials";
import { getTenantConfig } from "@/lib/config/tenantConfig";
import { capabilitiesWithWrites, decideWrite, overWriteLimit, requestFingerprint, WRITE_WINDOW_MS, retryableWriteFailure, validateWriteRequest, writesEnabled, type WriteRequestInput } from "./connectorWriteRules";
import { ConnectorRequestError } from "./framework/http";
import { parseConnectorConfig, writeCapabilitiesOf } from "./framework/engine";
import { DEFINITION_WRITE_OPERATIONS, type DefinitionWriteOperation } from "./framework/types";
import { createSystemSyncJob, runSyncJob } from "./syncJobs";
import { runAfterResponse } from "@/lib/shared/afterResponse";
import { CONNECTOR_WRITE_OPERATIONS, type ConnectorWriteOperation } from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-11 — the connector write interface. Not exposed as a
 * route: governed callers (the provisioning pipeline of INTEGRATION-P0-13,
 * after approval) call it through the module contract.
 *
 * Order: validate → claim the idempotency key (the unique insert is the
 * lock) → decide (declared capability, integration not disabled, the
 * mass-change guard of QA-P0-26: at most the configured changes per
 * connection per hour; counting after the claim, so writes racing each
 * other see each other and the guard errs towards refusing) → call
 * the connector → record the outcome → audit. A repeated key returns the
 * recorded outcome (or "requested" while the first call is still running);
 * a key reused for a different request is refused. Service role, with an
 * explicit tenant filter on every statement (§14).
 */

type Row = Record<string, unknown>;

function toResult(r: Row, replayed: boolean): ConnectorWriteResult {
  return {
    id: r.id as string,
    integrationId: r.integration_id as string,
    idempotencyKey: r.idempotency_key as string,
    operation: r.operation as ConnectorWriteResult["operation"],
    status: r.status as ConnectorWriteResult["status"],
    replayed,
    externalId: (r.external_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
  };
}

export async function executeConnectorWrite(tenantId: string, actorId: string | null, integrationId: string, input: WriteRequestInput): Promise<ConnectorWriteResult> {
  const request = validateWriteRequest(input);
  const fingerprint = requestFingerprint(request.operation, request.target);
  const supabase = supabaseServiceRole();

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("id, integration_type_id, config, capabilities, status")
    .eq("tenant_id", tenantId)
    .eq("id", integrationId)
    .maybeSingle();
  if (integrationError) throw new ApiError(500, "QUERY_FAILED", integrationError.message);
  if (!integration) throw new ApiError(404, "NOT_FOUND", "That integration is not in this organization");

  // Claim the key. A conflict means this request (or another with the same
  // key) was seen before: return what happened then.
  const { data: claimed, error: claimError } = await supabase
    .from("connector_write_operations")
    .insert({
      tenant_id: tenantId,
      integration_id: integrationId,
      idempotency_key: request.idempotencyKey,
      operation: request.operation,
      request_fingerprint: fingerprint,
      target: request.target,
      requested_by: actorId,
    })
    .select()
    .single();
  if (claimError?.code === "23505") {
    const { data: prior, error: priorError } = await supabase
      .from("connector_write_operations")
      .select()
      .eq("tenant_id", tenantId)
      .eq("integration_id", integrationId)
      .eq("idempotency_key", request.idempotencyKey)
      .single();
    if (priorError || !prior) throw new ApiError(500, "QUERY_FAILED", priorError?.message ?? "Idempotency record missing");
    if (prior.request_fingerprint !== fingerprint) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different request");
    }
    return toResult(prior, true);
  }
  if (claimError || !claimed) throw new ApiError(500, "WRITE_FAILED", claimError?.message ?? "Could not record the write");

  const finish = async (status: "succeeded" | "failed" | "blocked", externalId: string | null, error: string | null, retryable = false) => {
    const { data, error: updateError } = await supabase
      .from("connector_write_operations")
      .update({ status, external_id: externalId, error, completed_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", claimed.id as string)
      .select()
      .single();
    if (updateError || !data) throw new ApiError(500, "UPDATE_FAILED", updateError?.message ?? "Could not record the outcome");
    await writeAudit({
      tenantId,
      actorId,
      actorType: actorId ? "user" : "system",
      action: `integration.write_${status}`,
      objectType: "integration",
      objectId: integrationId,
      outcome: status === "succeeded" ? "success" : "failure",
      correlationId: claimed.id as string,
      // Identifiers only: target fields were validated to carry no secrets.
      metadata: { operation: request.operation, idempotencyKey: request.idempotencyKey, target: request.target, error },
    });
    return { ...toResult(data, false), retryable };
  };

  const decision = decideWrite(request.operation, (integration.capabilities ?? {}) as ConnectorCapabilities, integration.status as string);
  if (!decision.run) return finish("blocked", null, decision.reason);

  // QA-P0-26: the mass-change guard. Changes made or in flight in the last hour, not counting this one.
  const [{ count, error: countError }, config] = await Promise.all([
    supabase
      .from("connector_write_operations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("integration_id", integrationId)
      .in("status", ["requested", "succeeded"])
      .neq("id", claimed.id as string)
      .gte("created_at", new Date(Date.now() - WRITE_WINDOW_MS).toISOString()),
    getTenantConfig(tenantId),
  ]);
  if (countError) return finish("blocked", null, "The mass-change guard could not count recent changes");
  const guard = overWriteLimit(count ?? 0, config["integration.maxWritesPerHour"]);
  if (!guard.run) return finish("blocked", null, guard.reason);

  // Any request a write makes passes the connection's Connector Gateway session.
  const gateway = openGateway({ tenantId, integrationId, status: integration.status as string });
  let connector: ConnectorAdapter;
  try {
    connector = createConnector(integration.integration_type_id as string, gateway);
  } catch {
    return finish("failed", null, "This integration type has no connector");
  }
  if (!connector.write) return finish("failed", null, "The connector does not implement writes");
  try {
    const secret = await getDecryptedCredential(tenantId, integrationId);
    await connector.authenticate((integration.config ?? {}) as Record<string, unknown>, secret);
    const out = await connector.write(request.operation, request.target, request.idempotencyKey);
    return finish("succeeded", out.externalId ?? null, null);
  } catch (err) {
    const kind = err instanceof ConnectorRequestError ? "http" : err instanceof TypeError ? "network" : "other";
    const status = err instanceof ConnectorRequestError ? err.status : undefined;
    return finish("failed", null, err instanceof Error ? err.message.slice(0, 1000) : "The write failed", retryableWriteFailure(status, kind));
  } finally {
    await keepObtainedTokens(tenantId, integrationId, connector);
    await gateway.flush();
  }
}

// ------------------------------------------------- INTEGRATION-P0-13 (D3)

type ConnectionRow = { id: string; tenant_id: string; integration_type_id: string; config: Record<string, unknown> | null; capabilities: ConnectorCapabilities | null; status: string };

async function loadConnection(tenantId: string, integrationId: string): Promise<ConnectionRow> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(integrationId)) throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  const { data, error } = await supabaseServiceRole()
    .from("integrations")
    .select("id, tenant_id, integration_type_id, config, capabilities, status")
    .eq("tenant_id", tenantId)
    .eq("id", integrationId)
    .maybeSingle<ConnectionRow>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  return data;
}

/** The writes a connection's definition supports (none for a non-connector or an unreadable definition). */
function supportedWrites(row: ConnectionRow): ConnectorCapabilities {
  if (row.integration_type_id !== "connector") return {};
  try {
    return writeCapabilitiesOf(parseConnectorConfig(row.config ?? {}).def);
  } catch {
    return {};
  }
}

export type ConnectionWrites = { supported: DefinitionWriteOperation[]; enabled: boolean };

/** What a connection could change in the system, and whether an administrator has turned that on. */
export async function getConnectionWrites(tenantId: string, integrationId: string): Promise<ConnectionWrites> {
  const row = await loadConnection(tenantId, integrationId);
  const supported = supportedWrites(row);
  return {
    supported: DEFINITION_WRITE_OPERATIONS.filter((op) => supported[CONNECTOR_WRITE_OPERATIONS[op]] === true),
    enabled: writesEnabled(row.capabilities ?? {}),
  };
}

/**
 * Turns writes on or off for one connection (decision D3: per connection,
 * declared, enabled by the organization). On declares every write its
 * definition supports; off declares none, and connectorWrites refuses any
 * write at once. The caller has checked integration.update. Audited.
 */
export async function setConnectionWrites(tenantId: string, actorId: string, integrationId: string, enabled: unknown): Promise<ConnectionWrites> {
  if (typeof enabled !== "boolean") throw new ApiError(400, "INVALID_INPUT", "enabled: true or false");
  const row = await loadConnection(tenantId, integrationId);
  const supported = supportedWrites(row);
  if (enabled && !Object.values(supported).some(Boolean)) throw new ApiError(409, "NOT_SUPPORTED", "This connection's definition makes no changes in the system");
  const capabilities = capabilitiesWithWrites(row.capabilities ?? {}, supported, enabled);
  const { data, error } = await supabaseServiceRole()
    .from("integrations")
    .update({ capabilities })
    .eq("tenant_id", tenantId)
    .eq("id", integrationId)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "SAVE_FAILED", "The setting could not be saved");
  if (!data) throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  const operations = DEFINITION_WRITE_OPERATIONS.filter((op) => capabilities[CONNECTOR_WRITE_OPERATIONS[op]] === true);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: enabled ? "integration.writes_enabled" : "integration.writes_disabled",
    objectType: "integration",
    objectId: integrationId,
    outcome: "success",
    metadata: { operations },
  });
  return { supported: DEFINITION_WRITE_OPERATIONS.filter((op) => supported[CONNECTOR_WRITE_OPERATIONS[op]] === true), enabled };
}

/** Whether this connection may make this change now: declared (writes on), supported, and not disabled. */
export async function connectionCanWrite(tenantId: string, integrationId: string, operation: ConnectorWriteOperation): Promise<boolean> {
  const row = await loadConnection(tenantId, integrationId).catch(() => null);
  if (!row) return false;
  return decideWrite(operation, row.capabilities ?? {}, row.status).run && supportedWrites(row)[CONNECTOR_WRITE_OPERATIONS[operation]] === true;
}

/**
 * Reads the system again after a write, so reconciliation (not the write's
 * own answer) decides whether the change is there. Runs after the
 * response; never throws.
 */
export async function startVerificationSync(tenantId: string, integrationId: string): Promise<void> {
  try {
    const job = await createSystemSyncJob(tenantId, integrationId, "verification");
    if (job) runAfterResponse(() => runSyncJob(tenantId, job.id));
  } catch (err) {
    console.error("verification sync not started", { tenantId, integrationId, error: err instanceof Error ? err.message : "unknown" });
  }
}

