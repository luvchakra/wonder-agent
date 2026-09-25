import "server-only";

import type { RuntimeEvent, RuntimeEventQuarantineEntry, RuntimeResource, RuntimeTool } from "@/lib/shared/types/runtime";

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

export function toRuntimeEvent(row: any): RuntimeEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    identityId: row.identity_id,
    eventTime: row.event_time,
    receivedAt: row.received_at,
    source: row.source,
    tool: row.tool,
    application: row.application,
    resource: row.resource,
    action: row.action,
    dataClassification: row.data_classification,
    success: row.success,
    raw: row.raw ?? {},
    dedupeKey: row.dedupe_key,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    eventType: row.event_type ?? "API_CALL",
    sessionId: row.session_id ?? null,
    decisionId: row.decision_id ?? null,
    mcpServer: row.mcp_server ?? null,
  };
}

export function toRuntimeTool(row: any): RuntimeTool {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    name: row.name,
    sourceIntegrationId: row.source_integration_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function toRuntimeResource(row: any): RuntimeResource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    application: row.application,
    resource: row.resource,
    dataClassification: row.data_classification,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function toRuntimeEventQuarantineEntry(row: any): RuntimeEventQuarantineEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    reason: row.reason,
    source: row.source,
    action: row.action,
    submittedEventTime: row.submitted_event_time,
    attemptedDedupeKey: row.attempted_dedupe_key,
    receivedAt: row.received_at,
  };
}
