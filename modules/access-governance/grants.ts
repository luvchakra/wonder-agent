import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AccessGrant, AccessPath, GrantType } from "@/lib/shared/types/access-governance";
import { toAccessGrant } from "./mappers";
import { enforceSoD } from "./sod";

type EffectiveAccessRow = {
  id: string;
  tenant_id: string;
  account_id: string;
  entitlement_id: string;
  grant_type: GrantType;
  source_integration_id: string | null;
  granted_at: string;
  revoked_at: string | null;
  accounts: { external_account_ref: string; application_id: string } | null;
  entitlements: {
    application_id: string;
    name: string;
    data_classification: string | null;
    privilege_level: string;
    applications: { name: string } | null;
    data_sources?: { id: string; name: string; classification: string | null } | null;
  } | null;
};

/**
 * ACCESS-P0-13: CAN carries the data source an entitlement opens. The
 * entitlement's own classification wins; the data source's fills in when
 * the entitlement has none, so an unclassified entitlement on a
 * restricted warehouse is not read as unclassified.
 */
export function dataFields(e: EffectiveAccessRow["entitlements"]) {
  const ds = e?.data_sources ?? null;
  return {
    dataClassification: e?.data_classification ?? ds?.classification ?? null,
    dataSource: ds ? { id: ds.id, name: ds.name, classification: ds.classification } : null,
  };
}

/**
 * ACCESS-P0-01.2 (higher bar). `access_grants` grants a client-facing SELECT
 * policy (migration 0027) — only writes are service-role-only — so reads run
 * as the calling user via supabaseServer(). Walks Agent -> accounts ->
 * access_grants -> entitlements -> applications and returns every currently
 * granted (revoked_at is null) entitlement, annotated with grant_type.
 */
export async function getEffectiveAccess(tenantId: string, agentId: string): Promise<AccessGrant[]> {
  return queryEffectiveAccess(tenantId, agentId, null);
}

/**
 * RUNTIME-P0-13's published dependency: effective access AS OF a specific
 * point in time, not "right now." `revokeAccessGrant()` (this file) always
 * soft-deletes via `revoked_at`, never hard-deletes a row, so the historical
 * data this needs already exists in `access_grants` — a grant was in force
 * at `asOf` iff `granted_at <= asOf and (revoked_at is null or revoked_at >
 * asOf)`. This lets Runtime Agent re-score an old event against the
 * entitlements that were actually in force when it happened, instead of
 * today's (already-possibly-revoked) entitlements — see this module's own
 * audit log for the full resolution of the dependency note Runtime Agent's
 * backlog recorded.
 */
export async function getEffectiveAccessAsOf(tenantId: string, agentId: string, asOf: string): Promise<AccessGrant[]> {
  return queryEffectiveAccess(tenantId, agentId, asOf);
}

async function queryEffectiveAccess(tenantId: string, agentId: string, asOf: string | null): Promise<AccessGrant[]> {
  const supabase = await supabaseServer();
  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId);
  if (accountsError) throw new ApiError(500, "QUERY_FAILED", accountsError.message);
  const accountIds = (accounts ?? []).map((a: { id: string }) => a.id);
  if (accountIds.length === 0) return [];

  let query = supabase
    .from("access_grants")
    .select("*, accounts(external_account_ref, application_id), entitlements(application_id, name, data_classification, privilege_level, applications(name), data_sources(id, name, classification))")
    .in("account_id", accountIds)
    .eq("tenant_id", tenantId);
  query = asOf === null ? query.is("revoked_at", null) : query.lte("granted_at", asOf).or(`revoked_at.is.null,revoked_at.gt.${asOf}`);

  const { data, error } = await query.returns<EffectiveAccessRow[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  return (data ?? []).map((row) => ({
    ...toAccessGrant(row),
    application: row.entitlements?.applications?.name,
    applicationId: row.entitlements?.application_id,
    entitlementName: row.entitlements?.name,
    ...dataFields(row.entitlements),
    privilegeLevel: row.entitlements?.privilege_level as AccessGrant["privilegeLevel"],
  }));
}

/**
 * COMPLIANCE-P0-01.3's published dependency: a single grant by id, for a
 * certification reviewer's "modify" decision to resolve which entitlement
 * (and therefore which application) the resulting access_requests row
 * should target. `access_grants` grants a client-facing SELECT policy
 * (migration 0027), so this runs as the calling user via supabaseServer(),
 * same as getEffectiveAccess().
 */
export async function getAccessGrant(tenantId: string, grantId: string): Promise<AccessGrant | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("access_grants")
    .select("*, entitlements(application_id, name, data_classification, privilege_level, applications(name), data_sources(id, name, classification))")
    .eq("id", grantId)
    .eq("tenant_id", tenantId)
    .maybeSingle<EffectiveAccessRow>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;
  return {
    ...toAccessGrant(data),
    application: data.entitlements?.applications?.name,
    applicationId: data.entitlements?.application_id,
    entitlementName: data.entitlements?.name,
    ...dataFields(data.entitlements),
    privilegeLevel: data.entitlements?.privilege_level as AccessGrant["privilegeLevel"],
  };
}

/**
 * ACCESS-P0-01.2: "why can X access Y" — the specific chain from agent
 * identity through to the entitlement, for one resource reference in the
 * form "Application:Entitlement" (e.g. "Snowflake:CustomerDB_READ") or just
 * "Application" to match any entitlement on that application.
 */
export async function explainAccessPath(
  tenantId: string,
  agentId: string,
  resourceRef: string,
): Promise<AccessPath | null> {
  const [applicationName, entitlementName] = resourceRef.includes(":")
    ? resourceRef.split(":", 2)
    : [resourceRef, undefined];

  const supabase = await supabaseServer();
  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, external_account_ref, application_id, applications(name)")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .returns<{ id: string; external_account_ref: string; application_id: string; applications: { name: string } | null }[]>();
  if (accountsError) throw new ApiError(500, "QUERY_FAILED", accountsError.message);

  const matchingAccounts = (accounts ?? []).filter((a) => a.applications?.name === applicationName);
  if (matchingAccounts.length === 0) return null;

  const { data: grants, error: grantsError } = await supabase
    .from("access_grants")
    .select("*, entitlements(name, data_classification, applications(name))")
    .in(
      "account_id",
      matchingAccounts.map((a) => a.id),
    )
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .returns<EffectiveAccessRow[]>();
  if (grantsError) throw new ApiError(500, "QUERY_FAILED", grantsError.message);

  const match = (grants ?? []).find((g) => !entitlementName || g.entitlements?.name === entitlementName);
  if (!match) return null;

  const account = matchingAccounts.find((a) => a.id === match.account_id)!;

  return {
    agentId,
    resource: resourceRef,
    path: [
      { step: "agent_identity", ref: account.external_account_ref },
      { step: "account", ref: `${account.external_account_ref}@${account.applications?.name}` },
      { step: "access_grant", ref: match.id, type: match.grant_type, entitlement: match.entitlements?.name },
      {
        step: "entitlement",
        ref: match.entitlements?.name ?? "",
        application: match.entitlements?.applications?.name,
        dataClassification: match.entitlements?.data_classification,
      },
    ],
  };
}

/**
 * Writes go through the service-role client — access_grants has no
 * client-facing INSERT/UPDATE policy at all (migration 0027's comment) —
 * so every query here explicitly re-verifies tenant ownership of the
 * account/entitlement rather than relying on RLS.
 */
export async function createManualAccessGrant(
  tenantId: string,
  actorId: string,
  accountId: string,
  entitlementId: string,
  grantType: GrantType = "direct",
): Promise<AccessGrant> {
  const supabase = supabaseServiceRole();

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, agent_id")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; agent_id: string | null }>();
  if (accountError) throw new ApiError(500, "QUERY_FAILED", accountError.message);
  if (!account) throw new ApiError(404, "ACCOUNT_NOT_FOUND");
  // ACCESS-P0-17: accounts of people and other identities are inventoried,
  // but granting to them waits for human access governance (ACCESS-P0-20),
  // where separation of duties covers them. Refuse rather than skip SoD.
  if (!account.agent_id) throw new ApiError(409, "NOT_SUPPORTED", "Grants to accounts that do not belong to an AI agent are not supported yet");

  const { data: entitlement, error: entitlementError } = await supabase
    .from("entitlements")
    .select("id")
    .eq("id", entitlementId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (entitlementError) throw new ApiError(500, "QUERY_FAILED", entitlementError.message);
  if (!entitlement) throw new ApiError(404, "ENTITLEMENT_NOT_FOUND");

  // ACCESS-P0-14: separation of duties, before the grant exists.
  await enforceSoD(tenantId, actorId, "access.grant_created", account.agent_id);

  const { data, error } = await supabase
    .from("access_grants")
    .insert({ tenant_id: tenantId, account_id: accountId, entitlement_id: entitlementId, grant_type: grantType })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create access grant");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.grant_created",
    objectType: "access_grant",
    objectId: data.id,
    outcome: "success",
    metadata: { accountId, entitlementId, grantType, agentId: account.agent_id },
  });

  return toAccessGrant(data);
}

export async function revokeAccessGrant(tenantId: string, actorId: string, grantId: string): Promise<void> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("access_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .eq("tenant_id", tenantId)
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "GRANT_NOT_FOUND");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.grant_revoked",
    objectType: "access_grant",
    objectId: grantId,
    outcome: "success",
    metadata: {},
  });
}
