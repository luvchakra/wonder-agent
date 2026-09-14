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
import { RestHttpClient } from "./restHttpClient";

/**
 * INTEGRATION-P0-02.1. READ-ONLY in P0 — createAccessRequest/removeAccess/
 * importActivity are deliberately absent from capabilities (P1).
 *
 * Verified against the user-provided "Saviynt Enterprise Identity Cloud API
 * Reference v24.2" (the real product documentation — an earlier attempt to
 * fetch it from documenter.getpostman.com was blocked by this sandbox's
 * egress policy; see docs/design/integration-agent-backlog-audit.md,
 * "Attempted Saviynt API doc verification" and the follow-up entry once
 * the user pasted the reference directly). This resolved the endpoint
 * paths, HTTP method, and pagination mechanism below — all previously
 * unverified guesses.
 *
 * What the reference confirms:
 * - Base URL pattern: `{{url}}/ECM/{{path}}/apiName`, where `{{path}}` is
 *   `api/v5` for SSM 5.2+ (used here) or `api` for older versions.
 * - Auth: `POST {{url}}/ECM/api/login` with `{"username","password"}` in
 *   the body returns a Token; every other call sends
 *   `Authorization: Bearer <token>` — matches this connector's existing
 *   `authType: "bearer"` choice, so `secret` is expected to already be a
 *   valid Saviynt API token obtained/refreshed out of band (via that login
 *   call or `POST /ECM/oauth/access_token`) and stored the same way every
 *   other connector's credential is stored (Integration Agent's
 *   `encryptSecret()`) — this connector does not itself perform the
 *   username/password exchange, consistent with every other connector in
 *   this module never handling raw end-user credentials directly.
 * - **The list endpoints are `POST` requests with `max`/`offset` pagination
 *   parameters in the JSON request body — not `GET` with query-string
 *   pagination.** This was the single biggest correction: the connector
 *   previously used `RestHttpClient.fetchAllPages()` (GET-only). It now
 *   uses the new `RestHttpClient.postAllPages()` (added alongside this fix)
 *   instead.
 * - Real, confirmed endpoint paths (all under `/ECM/api/v5/`): `getUser`
 *   (identities), `getAccounts` (accounts), `getEndpoints` (applications —
 *   Saviynt's own term for what WonderAgent calls an "application" is
 *   "Endpoint," a child of a "Security System"), `getEntitlements`
 *   (entitlements), `getEntDetailsforUsers` (a flat, paginated
 *   user+account+entitlement response — used for "access," since it is the
 *   one bulk, paginated endpoint that returns account-entitlement
 *   associations without requiring a specific username up front, unlike
 *   `getAccessDetailsForUser` which mandates one).
 * - **Flagged, not silently assumed**: Saviynt's core Identity
 *   Administration API (this reference's scope) has no generic "list of
 *   governance policies" endpoint — its closest concepts are Segregation-
 *   of-Duties rulesets/violations (`8.0 Segregation of Duties` in the
 *   reference) and per-target-system "technical rules," both with
 *   different, purpose-specific shapes, not a flat named-policy list.
 *   `getSecuritySystems` (a real, paginated, list-all endpoint) is kept as
 *   the closest working analog — a named top-level system boundary — since
 *   it is a real, confirmed endpoint rather than an invented one; mapping
 *   Saviynt's actual SOD rulesets into `NormalizedPolicy` is a better fit
 *   left for a dedicated future story once that's actually needed.
 * - **What remains unverified**: this reference documents request shapes
 *   (it is a Postman collection export) but does not show response body
 *   schemas anywhere. The field names below (`username`, `name` for an
 *   account, `entitlement_value`/`entitlementtype` for an entitlement,
 *   `endpointname`/`endpointkey` for an endpoint, `systemname` for a
 *   security system) are inferred from the field names Saviynt's own
 *   request/filter parameters and object-literal examples use consistently
 *   throughout the reference (e.g. `getChildEntitlements`'s worked example
 *   body literally contains `{"endpointkey":"1","endpointname":"AWS",...}`
 *   as an object shape) — a much better-grounded inference than the
 *   previous "commonly documented REST conventions" guess, but still not a
 *   confirmed live response payload. Confirm against an actual tenant
 *   response before production use.
 *
 * Config shape:
 * {
 *   baseUrl: string,
 *   endpoints?: { identities?, accounts?, applications?, entitlements?, access?, policies?: string },
 *   pageSize?: number,   // default 100, per getEntDetailsforUsers' documented default
 * }
 * secret: a Saviynt API bearer token (see auth note above).
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
    applications: "/ECM/api/v5/getEndpoints",
    entitlements: "/ECM/api/v5/getEntitlements",
    access: "/ECM/api/v5/getEntDetailsforUsers",
    policies: "/ECM/api/v5/getSecuritySystems",
  };

  private static readonly DEFAULT_PAGE_SIZE = 100;

  async authenticate(config: ConnectorConfig, secret: string | null): Promise<void> {
    if (!config.baseUrl || typeof config.baseUrl !== "string") {
      throw new Error("Saviynt connector requires config.baseUrl");
    }
    this.config = config;
    this.client = new RestHttpClient(config.baseUrl, "bearer", secret);
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await this.client.post(this.endpoint("policies"), { max: 1, offset: 0 });
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

  private pageSize(): number {
    return (this.config.pageSize as number | undefined) ?? SaviyntConnector.DEFAULT_PAGE_SIZE;
  }

  /**
   * Every list endpoint here is POST + `max`/`offset` in the body, per the
   * verified reference — see this class's docblock. `dataPath` is left
   * unset (top-level array) since the actual response envelope key is one
   * of the still-unverified details noted above; adjust once confirmed
   * against a live tenant (Saviynt commonly wraps list responses in a
   * named key rather than a bare array — expect to set this).
   */
  private async fetchAll(key: string, extraBody: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
    return this.client.postAllPages(this.endpoint(key), extraBody, { pageSize: this.pageSize() });
  }

  async importIdentities(): Promise<ImportedRecord<NormalizedIdentity>[]> {
    const raw = await this.fetchAll("identities");
    return raw.map((r) => ({
      externalId: String(r.username ?? r.id),
      raw: r,
      normalized: {
        externalId: String(r.username ?? r.id),
        displayName: (r.displayname as string) ?? (r.firstname && r.lastname ? `${r.firstname} ${r.lastname}` : undefined),
        email: r.email as string | undefined,
        identityType: "service_account",
      },
    }));
  }

  async importAccounts(): Promise<ImportedRecord<NormalizedAccount>[]> {
    const raw = await this.fetchAll("accounts");
    return raw.map((r) => ({
      externalId: String(r.name ?? r.accountID ?? r.id),
      raw: r,
      normalized: {
        externalId: String(r.name ?? r.accountID ?? r.id),
        application: String(r.endpoint ?? r.endpointname ?? ""),
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
      externalId: String(r.endpointkey ?? r.endpointname ?? r.id),
      raw: r,
      normalized: {
        externalId: String(r.endpointkey ?? r.endpointname ?? r.id),
        name: String(r.endpointname ?? r.displayName ?? ""),
        category: (r.connectionType as string) ?? undefined,
      },
    }));
  }

  async importEntitlements(): Promise<ImportedRecord<NormalizedEntitlement>[]> {
    const raw = await this.fetchAll("entitlements");
    return raw.map((r) => ({
      externalId: String(r.entitlement_valuekey ?? r.entitlementID ?? r.entitlement_value ?? r.id),
      raw: r,
      normalized: {
        externalId: String(r.entitlement_valuekey ?? r.entitlementID ?? r.entitlement_value ?? r.id),
        application: String(r.endpoint ?? r.endpointname ?? ""),
        name: String(r.entitlement_value ?? r.displayname ?? ""),
        dataClassification: r.dataclassification as string | undefined,
        privilegeLevel: (r.privilegelevel as "standard" | "elevated" | "admin") ?? "standard",
      },
    }));
  }

  async importAccess(): Promise<ImportedRecord<NormalizedAccessGrant>[]> {
    const raw = await this.fetchAll("access");
    return raw.map((r, i) => ({
      externalId: String(r.id ?? `${r.username ?? r.accountname}-${r.entitlement_value ?? r.entitlementname}-${i}`),
      raw: r,
      normalized: {
        externalId: String(r.id ?? `${r.username ?? r.accountname}-${r.entitlement_value ?? r.entitlementname}-${i}`),
        accountExternalId: String(r.accountname ?? r.username ?? ""),
        entitlementExternalId: String(r.entitlement_value ?? r.entitlementname ?? ""),
        grantType: (r.assignmenttype as string) ?? "direct",
      },
    }));
  }

  async importPolicies(): Promise<ImportedRecord<NormalizedPolicy>[]> {
    const raw = await this.fetchAll("policies");
    return raw.map((r) => ({
      externalId: String(r.systemname ?? r.id),
      raw: r,
      normalized: {
        externalId: String(r.systemname ?? r.id),
        name: String(r.systemname ?? r.name ?? ""),
        description: r.description as string | undefined,
      },
    }));
  }
}
