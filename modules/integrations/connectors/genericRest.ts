import "server-only";

import type { ConnectorAdapter, ConnectorConfig, ImportedRecord } from "../connector";
import type {
  ConnectorCapabilities,
  NormalizedAccessGrant,
  NormalizedAccount,
  NormalizedApplication,
  NormalizedEntitlement,
  NormalizedIdentity,
} from "@/lib/shared/types/integrations";
import { RestHttpClient, type AuthType, type PaginationConfig } from "./restHttpClient";

/**
 * INTEGRATION-P0-03.1. Customer-configurable connector for in-house/custom
 * IAM products. `normalized` is intentionally left undefined on every
 * imported record — see connector.ts's docblock — the sync executor applies
 * this integration's stored field mappings afterward.
 *
 * Config shape:
 * {
 *   baseUrl: string,
 *   authType: 'oauth2' | 'api_key' | 'basic' | 'bearer' | 'mtls',
 *   apiKeyHeader?: string,        // default 'x-api-key'
 *   headers?: Record<string,string>,
 *   testPath?: string,            // default '/', a lightweight authenticated GET
 *   rateLimitPerSecond?: number,  // default 5
 *   pagination?: PaginationConfig,
 *   endpoints?: { identities?, accounts?, applications?, entitlements?, access?: string },
 * }
 */
export class GenericRestConnector implements ConnectorAdapter {
  readonly capabilities: ConnectorCapabilities = {
    importIdentities: true,
    importAccounts: true,
    importApplications: true,
    importEntitlements: true,
    importAccess: true,
    importActivity: false,
    provision: false,
    deprovision: false,
  };

  private config: ConnectorConfig = {};
  private client!: RestHttpClient;

  async authenticate(config: ConnectorConfig, secret: string | null): Promise<void> {
    if (!config.baseUrl || typeof config.baseUrl !== "string") {
      throw new Error("Generic REST connector requires config.baseUrl");
    }
    if (config.authType === "mtls") {
      throw new Error("mTLS is not implemented in P0 for the Generic REST connector");
    }
    this.config = config;
    this.client = new RestHttpClient(
      config.baseUrl,
      config.authType as AuthType | undefined,
      secret,
      config.headers as Record<string, string> | undefined,
      (config.apiKeyHeader as string) ?? "x-api-key",
      (config.rateLimitPerSecond as number) ?? 5,
    );
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await this.client.get((this.config.testPath as string) ?? "/");
      return res.ok ? { ok: true } : { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return this.testConnection();
  }

  private toImportedRecords<T>(records: Record<string, unknown>[]): ImportedRecord<T>[] {
    return records.map((raw) => ({
      externalId: String(raw.id ?? raw.externalId ?? raw.external_id ?? crypto.randomUUID()),
      raw,
    }));
  }

  private endpoint(key: string): string | undefined {
    return (this.config.endpoints as Record<string, string> | undefined)?.[key];
  }

  private async importFrom<T>(key: string): Promise<ImportedRecord<T>[]> {
    const path = this.endpoint(key);
    if (!path) return [];
    const pagination = this.config.pagination as PaginationConfig | undefined;
    return this.toImportedRecords<T>(await this.client.fetchAllPages(path, pagination));
  }

  importIdentities(): Promise<ImportedRecord<NormalizedIdentity>[]> {
    return this.importFrom("identities");
  }
  importAccounts(): Promise<ImportedRecord<NormalizedAccount>[]> {
    return this.importFrom("accounts");
  }
  importApplications(): Promise<ImportedRecord<NormalizedApplication>[]> {
    return this.importFrom("applications");
  }
  importEntitlements(): Promise<ImportedRecord<NormalizedEntitlement>[]> {
    return this.importFrom("entitlements");
  }
  importAccess(): Promise<ImportedRecord<NormalizedAccessGrant>[]> {
    return this.importFrom("access");
  }
}
