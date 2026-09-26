import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ConnectorCapabilities, ConnectorWriteResult } from "@/lib/shared/types/integrations";
import { createConnector } from "./registry";
import { getDecryptedCredential } from "./credentials";
import { decideWrite, requestFingerprint, validateWriteRequest, type WriteRequestInput } from "./connectorWriteRules";

/**
 * INTEGRATION-P0-11 — the connector write interface. Not exposed as a
 * route: governed callers (the provisioning pipeline of INTEGRATION-P0-13,
 * after approval) call it through the module contract.
 *
 * Order: validate → claim the idempotency key (the unique insert is the
 * lock) → decide (declared capability, integration not disabled) → call
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

  const finish = async (status: "succeeded" | "failed" | "blocked", externalId: string | null, error: string | null) => {
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
    return toResult(data, false);
  };

  const decision = decideWrite(request.operation, (integration.capabilities ?? {}) as ConnectorCapabilities, integration.status as string);
  if (!decision.run) return finish("blocked", null, decision.reason);

  let connector;
  try {
    connector = createConnector(integration.integration_type_id as string);
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
    return finish("failed", null, err instanceof Error ? err.message.slice(0, 1000) : "The write failed");
  }
}
