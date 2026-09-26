/**
 * Shared contracts owned by the Foundation Agent (docs/plan/01-FOUNDATION-AGENT-BACKLOG.md).
 * Other modules import these instead of redefining tenant/user/RBAC/audit shapes.
 */

export type TenantContext = {
  userId: string;
  tenantId: string | null;
  tenantSlug: string | null;
  /** Roles in effect across the whole tenant (valid now, conditions met). */
  roles: string[];
  /** Permissions usable without naming a resource (FOUNDATION-P0-19: tenant-wide grants, after policies). */
  permissions: string[];
  /**
   * FOUNDATION-P0-19 — the facts the authorization engine decides from:
   * every role assignment in this tenant (direct and through groups, with
   * scope, validity and conditions), the tenant's active policies, and the
   * session's assurance level. Absent on contexts built outside
   * getTenantContext() (tests), where `permissions` is the whole answer.
   */
  grants?: import("@/lib/rbac/authorizeCore").Grant[];
  policies?: import("@/lib/rbac/authorizeCore").AuthorizationPolicy[];
  aal?: "aal1" | "aal2" | null;
};

export type Role = {
  id: string;
  tenantId: string | null; // null = system role template
  name: string;
  description: string | null;
  isSystem: boolean;
};

export type Permission = {
  id: string;
  key: string;
  description: string;
};

export type AuditActorType = "user" | "system" | "integration";
export type AuditOutcome = "success" | "failure";

export type AuditEvent = {
  tenantId: string;
  actorId?: string | null;
  actorType: AuditActorType;
  action: string;
  objectType: string;
  objectId: string;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown>;
  correlationId?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// FOUNDATION-P0-03.3 — SSO connection foundation.
export type SsoProtocol = "saml" | "oidc";
export type SsoConnectionStatus = "active" | "disabled";

export type ClaimsMapping = {
  emailClaim?: string;
  roleClaim?: string;
  groupsClaim?: string;
  // Maps an IdP-asserted role/group value to a WonderAgent system role name.
  roleValueMap?: Record<string, string>;
};

export type SsoConnection = {
  id: string;
  tenantId: string;
  protocol: SsoProtocol;
  domain: string;
  idpMetadata: Record<string, unknown>;
  defaultRole: string;
  claimsMapping: ClaimsMapping;
  status: SsoConnectionStatus;
  createdAt: string;
};

export type SsoConnectionInput = {
  protocol: SsoProtocol;
  domain: string;
  idpMetadata: Record<string, unknown>;
  defaultRole?: string;
  claimsMapping?: ClaimsMapping;
};

// FOUNDATION-P0-17 — agent API keys (machine credential for the Runtime
// Gateway). The secret itself never appears in any of these types: it is
// returned once, as a separate string, by createAgentApiKey().
export type AgentApiKeyStatus = "active" | "revoked" | "expired";

export type AgentApiKey = {
  id: string;
  tenantId: string;
  agentId: string;
  name: string;
  /** Non-secret display prefix, e.g. "wa_ak_3F9x…". */
  keyPrefix: string;
  status: AgentApiKeyStatus;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
};

/** Who a verified agent API key proves the caller is. Tenant and agent come from the key, never the request. */
export type AgentKeyPrincipal = {
  keyId: string;
  tenantId: string;
  agentId: string;
};
