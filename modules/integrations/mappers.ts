import "server-only";

import type {
  Integration,
  IntegrationMapping,
  IntegrationObject,
  IntegrationSyncJob,
  IntegrationType,
} from "@/lib/shared/types/integrations";

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

export function toIntegrationType(row: any): IntegrationType {
  return {
    id: row.id,
    displayName: row.display_name,
    category: row.category,
    defaultCapabilities: row.default_capabilities ?? {},
  };
}

export function toIntegration(row: any, hasCredentials: boolean): Integration {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    integrationTypeId: row.integration_type_id,
    name: row.name,
    config: row.config ?? {},
    capabilities: row.capabilities ?? {},
    status: row.status,
    lastSyncAt: row.last_sync_at,
    nextSyncAt: row.next_sync_at,
    createdAt: row.created_at,
    hasCredentials,
  };
}

export function toSyncJob(row: any): IntegrationSyncJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    integrationId: row.integration_id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    recordsProcessed: row.records_processed,
    recordsFailed: row.records_failed,
    errors: row.errors ?? [],
    retryCount: row.retry_count,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}

export function toIntegrationObject(row: any): IntegrationObject {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    integrationId: row.integration_id,
    objectType: row.object_type,
    externalId: row.external_id,
    raw: row.raw,
    normalized: row.normalized,
    syncJobId: row.sync_job_id,
    importedAt: row.imported_at,
  };
}

export function toIntegrationMapping(row: any): IntegrationMapping {
  return {
    id: row.id,
    integrationId: row.integration_id,
    objectType: row.object_type,
    sourceField: row.source_field,
    targetField: row.target_field,
  };
}
