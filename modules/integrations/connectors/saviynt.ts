import "server-only";

import type { ConnectorAdapter, ConnectorConfig, ImportedRecord } from "../connector";
import type {
  ConnectorCapabilities,
  NormalizedAccessGrant,
  NormalizedAccount,
  NormalizedApplication,
  NormalizedEntitlement,
  NormalizedIdentity,
  NormalizedPolicy,
} from "@/lib/shared/types/integrations";
import { RestHttpClient, type PaginationConfig } from "./restHttpClient";

/**
 * INTEGRATION-P0-02.1. READ-ONLY in P0 — createAccessRequest/removeAccess/
 * importActivity are deliberately absent from capabilities (P1).
 *
 * IMPORTANT, flagged rather than silently assumed: Saviynt's REST API shape
 * (exact endpoint paths, field names, and auth flow) varies by deployment
 * and API version. This connector is built against Saviynt's commonly
 * documented conventions (a bearer-token-authenticated, paginated REST API
 * with configurable endpoint paths per object type) using the same
 * mechanics as the Generic REST connector, but its endpoint paths and field
 * mappings below are defaults, not a verified integration against a live
 * Saviynt tenant — this sandbox has no Saviynt instance to test against.
 * Before production use against a real customer tenant, confirm the actual
 * endpoint paths and response field names for that tenant's Saviynt version
 * and adjust `config.endpoints`/the field-normalization functions below
 * accordingly. This module's critical acceptance test
 * (docs/plan/03-INTEGRATION-AGENT-BACKLOG.md) is satisfied via the Generic
 * REST connector against a mock/test API, exactly as the backlog specifies —
 * it does not require a live Saviynt connection.
 *
 * Config shape:
 * {
 *   baseUrl: string,
 *   endpoints?: { identities?, accounts?, applications?, entitlements?, access?, policies?: string },
 *   pagination?: PaginationConfig,   // default: offset style, dataPath 'results'
 * }
 * secret: a Saviynt API bearer token.
 */
export class SaviyntConnector implements ConnectorAdapter {
  readonly capabilities: ConnectorCapabilities = {
    importIdentities: true,
    importAccounts: true,
    importApplications: true,
    importEntitlements: true,
    importAccess: true,
    importPolicies: true,
    importActivity: false,
    provision: false,
    deprovision: false,
  };

  private config: ConnectorConfig = {};
  private client!: RestHttpClient;

  private static readonly DEFAULT_ENDPOINTS: Record<string, string> = {
    identities: "/ECM/api/v5/getUser",
    accounts: "/ECM/api/v5/getAccounts",
    applications: "/ECM/api/v5/getApplications",
    entitlements: "/ECM/api/v5/getEntitlements",
    access: "/ECM/api/v5/getAccountEntitlements",
    policies: "/ECM/api/v5/getSecuritySystems",
  };

  private static readonly DEFAULT_PAGINATION: PaginationConfig = {
    style: "offset",
    pageParam: "page",
    sizeParam: "max",
    pageSize: 100,
    dataPath: "results",
  };

  async authenticate(config: ConnectorConfig, secret: string | null): Promise<void> {
    if (!config.baseUrl || typeof config.baseUrl !== "string") {
      throw new Error("Saviynt connector requires config.baseUrl");
    }
    this.config = config;
    this.client = new RestHttpClient(config.baseUrl, "bearer", secret);
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await this.client.get(this.endpoint("applications"));
      return res.ok ? { ok: true } : { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return this.testConnection();
  }

  private endpoint(key: string): string {
    const endpoints = { ...SaviyntConnector.DEFAULT_ENDPOINTS, ...(this.config.endpoints as Record<string, string> | undefined) };
    return endpoints[key];
  }

  private pagination(): PaginationConfig {
    return (this.config.pagination as PaginationConfig | undefined) ?? SaviyntConnector.DEFAULT_PAGINATION;
  }

  private async fetchAll(key: string): Promise<Record<string, unknown>[]> {
    return this.client.fetchAllPages(this.endpoint(key), this.pagination());
  }

  async importIdentities(): Promise<ImportedRecord<NormalizedIdentity>[]> {
    const raw = await this.fetchAll("identities");
    return raw.map((r) => ({
      externalId: String(r.username ?? r.accountname ?? r.id),
      raw: r,
      normalized: {
        externalId: String(r.username ?? r.accountname ?? r.id),
        displayName: (r.displayname as string) ?? (r.fullname as string),
        email: r.email as string | undefined,
        identityType: "service_account",
      },
    }));
  }

  async importAccounts(): Promise<ImportedRecord<NormalizedAccount>[]> {
    const raw = await this.fetchAll("accounts");
    return raw.map((r) => ({
      externalId: String(r.accountname ?? r.name ?? r.id),
      raw: r,
      normalized: {
        externalId: String(r.accountname ?? r.name ?? r.id),
        application: String(r.endpointname ?? r.application ?? ""),
        owner: r.accountowner as string | undefined,
        entitlements: Array.isArray(r.entitlements)
          ? (r.entitlements as unknown[]).map((e) => String(e))
          : undefined,
      },
    }));
  }

  async importApplications(): Promise<ImportedRecord<NormalizedApplication>[]> {
    const raw = await this.fetchAll("applications");
    return raw.map((r) => ({
      externalId: String(r.endpointkey ?? r.id),
      raw: r,
      normalized: {
        externalId: String(r.endpointkey ?? r.id),
        name: String(r.endpointname ?? r.displayname ?? r.name ?? ""),
        category: r.applicationtype as string | undefined,
      },
    }));
  }

  async importEntitlements(): Promise<ImportedRecord<NormalizedEntitlement>[]> {
    const raw = await this.fetchAll("entitlements");
    return raw.map((r) => ({
      externalId: String(r.entitlementname ?? r.id),
      raw: r,
      normalized: {
        externalId: String(r.entitlementname ?? r.id),
        application: String(r.endpointname ?? r.application ?? ""),
        name: String(r.entitlementname ?? r.displayname ?? ""),
        dataClassification: r.dataclassification as string | undefined,
        privilegeLevel: (r.privilegelevel as "standard" | "elevated" | "admin") ?? "standard",
      },
    }));
  }

  async importAccess(): Promise<ImportedRecord<NormalizedAccessGrant>[]> {
    const raw = await this.fetchAll("access");
    return raw.map((r, i) => ({
      externalId: String(r.id ?? `${r.accountname}-${r.entitlementname}-${i}`),
      raw: r,
      normalized: {
        externalId: String(r.id ?? `${r.accountname}-${r.entitlementname}-${i}`),
        accountExternalId: String(r.accountname ?? ""),
        entitlementExternalId: String(r.entitlementname ?? ""),
        grantType: (r.assignmenttype as string) ?? "direct",
      },
    }));
  }

  async importPolicies(): Promise<ImportedRecord<NormalizedPolicy>[]> {
    const raw = await this.fetchAll("policies");
    return raw.map((r) => ({
      externalId: String(r.id ?? r.securitysystemname),
      raw: r,
      normalized: {
        externalId: String(r.id ?? r.securitysystemname),
        name: String(r.securitysystemname ?? r.name ?? ""),
        description: r.description as string | undefined,
      },
    }));
  }
}
