import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { assertJsonSizeWithinLimit, assertOneOf } from "@/lib/security/validate";
import type {
  ClaimsMapping,
  SsoConnection,
  SsoConnectionInput,
} from "@/lib/shared/types/foundation";

type SsoConnectionRow = {
  id: string;
  tenant_id: string;
  protocol: "saml" | "oidc";
  domain: string;
  idp_metadata: Record<string, unknown>;
  default_role: string;
  claims_mapping: ClaimsMapping;
  status: "active" | "disabled";
  created_at: string;
};

function toSsoConnection(row: SsoConnectionRow): SsoConnection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    protocol: row.protocol,
    domain: row.domain,
    idpMetadata: row.idp_metadata,
    defaultRole: row.default_role,
    claimsMapping: row.claims_mapping ?? {},
    status: row.status,
    createdAt: row.created_at,
  };
}

/** FOUNDATION-P0-03.3 — tenant-scoped read of this tenant's SSO connections. */
export async function listSsoConnections(tenantId: string): Promise<SsoConnection[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("sso_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .returns<SsoConnectionRow[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toSsoConnection);
}

/**
 * Creates a tenant's SSO connection. `sso_connections` has no client INSERT
 * policy (configuring SSO is a privileged, audited action gated by
 * `sso.manage` and enforced here server-side), so this always writes via the
 * service-role client — the caller (an API route) must have already called
 * `requirePermission('sso.manage')` and must pass that verified tenantId,
 * never a client-supplied one.
 */
export async function createSsoConnection(
  tenantId: string,
  actorId: string,
  input: SsoConnectionInput,
): Promise<SsoConnection> {
  const domain = input.domain.trim().toLowerCase();
  if (!domain || !domain.includes(".")) {
    throw new ApiError(400, "INVALID_DOMAIN", "domain must be a valid email domain");
  }
  // FOUNDATION-P0-11 — shared input-safety contract: reject an unknown
  // protocol and cap idp_metadata's stored size before it ever reaches the
  // database.
  assertOneOf(input.protocol, ["saml", "oidc"] as const, "protocol");
  assertJsonSizeWithinLimit(input.idpMetadata, "idpMetadata", 16_384);

  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("sso_connections")
    .insert({
      tenant_id: tenantId,
      protocol: input.protocol,
      domain,
      idp_metadata: input.idpMetadata,
      default_role: input.defaultRole ?? "READ_ONLY",
      claims_mapping: input.claimsMapping ?? {},
    })
    .select("*")
    .single<SsoConnectionRow>();

  if (error || !data) {
    // unique(domain) violation is the most likely real-world failure here.
    throw new ApiError(409, "CREATE_FAILED", error?.message ?? "Failed to create SSO connection");
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "sso.connection_created",
    objectType: "sso_connection",
    objectId: data.id,
    outcome: "success",
    metadata: { domain, protocol: input.protocol },
  });

  return toSsoConnection(data);
}

/** Enable/disable an existing connection (tenant-verified, service-role write). */
export async function setSsoConnectionStatus(
  tenantId: string,
  actorId: string,
  connectionId: string,
  status: "active" | "disabled",
): Promise<SsoConnection> {
  const supabase = supabaseServiceRole();

  // Manually verify the row belongs to the caller's tenant before mutating
  // it — this is a service-role write, so RLS does not do this for us
  // (CLAUDE.md §14: service-role callers must verify tenant_id themselves).
  const { data: existing } = await supabase
    .from("sso_connections")
    .select("id, tenant_id")
    .eq("id", connectionId)
    .maybeSingle<{ id: string; tenant_id: string }>();

  if (!existing || existing.tenant_id !== tenantId) {
    throw new ApiError(404, "NOT_FOUND", "SSO connection not found");
  }

  const { data, error } = await supabase
    .from("sso_connections")
    .update({ status })
    .eq("id", connectionId)
    .select("*")
    .single<SsoConnectionRow>();

  if (error || !data) {
    throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to update SSO connection");
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: status === "active" ? "sso.connection_enabled" : "sso.connection_disabled",
    objectType: "sso_connection",
    objectId: connectionId,
    outcome: "success",
    metadata: { domain: data.domain },
  });

  return toSsoConnection(data);
}

/**
 * Public, unauthenticated lookup used by the sign-in page to decide whether
 * to offer an "SSO" path for a given email domain — returns only the
 * minimum needed to route the user (protocol + domain), never idp_metadata
 * or claims_mapping. Domain alone never grants tenant access (CLAUDE.md
 * §26 / non-negotiable #2) — it only picks which IdP flow to start.
 */
export async function findActiveSsoConnectionForDomain(
  domain: string,
): Promise<{ domain: string; protocol: "saml" | "oidc" } | null> {
  const supabase = supabaseServiceRole();
  const { data } = await supabase
    .from("sso_connections")
    .select("domain, protocol")
    .eq("domain", domain.trim().toLowerCase())
    .eq("status", "active")
    .maybeSingle<{ domain: string; protocol: "saml" | "oidc" }>();
  return data ?? null;
}

/**
 * Internal (server-only, not client-facing) full-detail lookup used by the
 * auth callback route to get claims_mapping/idp_metadata for JIT
 * provisioning — distinct from findActiveSsoConnectionForDomain(), which
 * intentionally exposes only {domain, protocol} to unauthenticated callers.
 */
export async function getFullActiveSsoConnectionByDomain(
  domain: string,
): Promise<SsoConnection | null> {
  const supabase = supabaseServiceRole();
  const { data } = await supabase
    .from("sso_connections")
    .select("*")
    .eq("domain", domain.trim().toLowerCase())
    .eq("status", "active")
    .maybeSingle<SsoConnectionRow>();
  return data ? toSsoConnection(data) : null;
}

/**
 * Resolves the WonderAgent system role to grant a just-in-time-provisioned
 * SSO user from the IdP's asserted claims, using the connection's
 * claims_mapping. Pure function (no I/O) so it's unit-testable without a
 * real IdP — see FOUNDATION-P0-03.3's stop-and-report note in the backlog:
 * the actual SAML/OIDC redirect handshake requires a real IdP and a
 * Supabase-project-level SSO provider configuration this environment cannot
 * create or verify; this mapping function is the deterministic part of the
 * flow that CAN be built and tested without one.
 */
export function resolveJitRole(
  claims: Record<string, unknown>,
  connection: Pick<SsoConnection, "claimsMapping" | "defaultRole">,
): string {
  const roleClaimKey = connection.claimsMapping.roleClaim;
  if (!roleClaimKey) return connection.defaultRole;

  const claimValue = claims[roleClaimKey];
  const values = Array.isArray(claimValue) ? claimValue : [claimValue];
  const roleValueMap = connection.claimsMapping.roleValueMap ?? {};

  for (const v of values) {
    if (typeof v === "string" && roleValueMap[v]) return roleValueMap[v];
  }
  return connection.defaultRole;
}

/**
 * Just-in-time tenant membership provisioning for a user who just completed
 * an SSO sign-in whose email domain matches an active `sso_connections` row.
 * Called from the auth callback route (a trusted server context) — never
 * from a client-invocable API, since domain-based provisioning must never be
 * client-triggerable (CLAUDE.md non-negotiable #2: never trust email domain
 * alone for tenant authorization; this function only ever runs after
 * Supabase Auth has already verified the user's identity via the IdP).
 *
 * Idempotent: if the user already has a membership in this tenant (e.g. a
 * repeat SSO login), this is a no-op and returns 'already_member'.
 */
export async function provisionSsoMembership(
  userId: string,
  connection: SsoConnection,
  claims: Record<string, unknown>,
): Promise<"provisioned" | "already_member"> {
  const supabase = supabaseServiceRole();

  const { data: existing } = await supabase
    .from("tenant_memberships")
    .select("id")
    .eq("tenant_id", connection.tenantId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string }>();

  if (existing) return "already_member";

  const roleName = resolveJitRole(claims, connection);

  const { data: role } = await supabase
    .from("roles")
    .select("id")
    .is("tenant_id", null)
    .eq("name", roleName)
    .maybeSingle<{ id: string }>();

  if (!role) {
    throw new ApiError(500, "UNKNOWN_ROLE", `SSO default/mapped role '${roleName}' does not exist`);
  }

  const { error: membershipError } = await supabase
    .from("tenant_memberships")
    .insert({ tenant_id: connection.tenantId, user_id: userId, status: "active" });
  if (membershipError) {
    throw new ApiError(500, "PROVISION_FAILED", membershipError.message);
  }

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ tenant_id: connection.tenantId, user_id: userId, role_id: role.id });
  if (roleError) {
    throw new ApiError(500, "PROVISION_FAILED", roleError.message);
  }

  await writeAudit({
    tenantId: connection.tenantId,
    actorId: userId,
    actorType: "system",
    action: "tenant_membership.sso_jit_provisioned",
    objectType: "tenant_membership",
    objectId: userId,
    outcome: "success",
    metadata: { source: "sso_jit", domain: connection.domain, role: roleName },
  });

  return "provisioned";
}
