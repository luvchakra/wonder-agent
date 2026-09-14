import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { getDecryptedCredential } from "./credentials";
import type { NormalizedRuntimeEvent } from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-04.2 (higher bar). Authenticates MCP proxy/observation
 * submissions with the integration's stored shared secret (same mechanism
 * as webhooks.ts) as a bearer token — never accepts unauthenticated event
 * ingestion. Runtime Agent does not exist yet, so normalized events are
 * buffered in integration_objects (object_type 'activity') rather than
 * written to a runtime_events table that doesn't exist — this hand-off
 * contract is explicitly noted as pending in the Integration Agent audit
 * log, per the backlog's own instruction not to invent Runtime Agent's
 * architecture.
 */
export type McpEventResult =
  | { ok: true }
  | { ok: false; status: 401 | 404; reason: string };

export async function ingestMcpRuntimeEvent(
  integrationId: string,
  bearerToken: string | null,
  event: NormalizedRuntimeEvent,
): Promise<McpEventResult> {
  if (!bearerToken) {
    return { ok: false, status: 401, reason: "Missing bearer token" };
  }

  const supabase = supabaseServiceRole();
  const { data: integration, error } = await supabase
    .from("integrations")
    .select("id, tenant_id")
    .eq("id", integrationId)
    .maybeSingle();
  if (error || !integration) {
    return { ok: false, status: 404, reason: "Integration not found" };
  }

  const secret = await getDecryptedCredential(integration.tenant_id, integration.id);
  if (!secret || secret !== bearerToken) {
    return { ok: false, status: 401, reason: "Invalid bearer token" };
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
    return { ok: false, status: 401, reason: insertError.message };
  }

  await writeAudit({
    tenantId: integration.tenant_id,
    actorType: "integration",
    action: "integration.mcp_event_ingested",
    objectType: "integration",
    objectId: integration.id,
    outcome: "success",
    metadata: { externalId, action: event.action, application: event.application },
  });

  return { ok: true };
}
