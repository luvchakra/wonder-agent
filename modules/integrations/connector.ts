import "server-only";

import type {
  AccessRequestInput,
  ConnectorCapabilities,
  DiscoveredObject,
  NormalizedAccessGrant,
  NormalizedAccount,
  NormalizedApplication,
  NormalizedEntitlement,
  NormalizedIdentity,
  NormalizedPolicy,
  NormalizedRuntimeEvent,
} from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-01.1. The common adapter contract every connector
 * implements. Not every connector implements every optional method — a
 * connector declares which ones it supports via its ConnectorCapabilities
 * (stored on the integrations row), and callers must check the declared
 * capability before invoking an optional method rather than assuming it
 * exists.
 *
 * Every import* method returns each record as `{ externalId, raw,
 * normalized }`. A connector that knows its source API's shape natively
 * (e.g. Saviynt) populates `normalized` directly. A connector driven by
 * customer-configured field mappings (Generic REST) leaves `normalized`
 * undefined and returns only `raw` — modules/integrations/mappings.ts's
 * applyMappings() fills it in afterward using that integration's stored
 * integration_mappings rows. This lets both connector styles share one
 * sync-execution path (modules/integrations/syncJobs.ts) without forcing
 * Generic REST to fake a mapping engine inside the connector itself.
 */
export type ConnectorConfig = Record<string, unknown>;

export type ImportedRecord<T> = {
  externalId: string;
  raw: Record<string, unknown>;
  normalized?: T;
};

export interface ConnectorAdapter {
  readonly capabilities: ConnectorCapabilities;

  authenticate(config: ConnectorConfig, secret: string | null): Promise<void>;
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;

  discover?(): Promise<DiscoveredObject[]>;
  importIdentities?(): Promise<ImportedRecord<NormalizedIdentity>[]>;
  importAccounts?(): Promise<ImportedRecord<NormalizedAccount>[]>;
  importApplications?(): Promise<ImportedRecord<NormalizedApplication>[]>;
  importEntitlements?(): Promise<ImportedRecord<NormalizedEntitlement>[]>;
  importAccess?(): Promise<ImportedRecord<NormalizedAccessGrant>[]>;
  importPolicies?(): Promise<ImportedRecord<NormalizedPolicy>[]>;
  importActivity?(): Promise<ImportedRecord<NormalizedRuntimeEvent>[]>;

  createAccessRequest?(request: AccessRequestInput): Promise<{ externalId: string }>;
  removeAccess?(grantRef: string): Promise<void>;
  getObject?(externalRef: string): Promise<DiscoveredObject | null>;
}
