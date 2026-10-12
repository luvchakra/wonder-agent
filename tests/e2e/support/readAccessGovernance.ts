import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * QA-P0-23 — read-only checks on what reconciliation recorded that no API
 * returns directly yet (ledger statuses, access findings, a grant's
 * missing-at-source time). Service role, always filtered on the tenant.
 */
function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function ledgerFor(tenantId: string, accountId: string): Promise<{ entitlementId: string | null; status: string; missingFromSourceAt: string | null }[]> {
  const { data, error } = await adminClient()
    .from("access_ledger")
    .select("entitlement_id, status, missing_from_source_at")
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId);
  if (error) throw new Error(`ledgerFor: ${error.message}`);
  return (data ?? []).map((r) => ({ entitlementId: r.entitlement_id, status: r.status, missingFromSourceAt: r.missing_from_source_at }));
}

export async function ledgerEvents(tenantId: string, accountId: string): Promise<string[]> {
  const { data, error } = await adminClient().from("access_ledger_events").select("event_type").eq("tenant_id", tenantId).eq("account_id", accountId);
  if (error) throw new Error(`ledgerEvents: ${error.message}`);
  return (data ?? []).map((r) => r.event_type as string);
}

export async function accessFindings(tenantId: string, accountId: string): Promise<{ status: string; entitlementId: string | null; title: string; resolutionType: string | null }[]> {
  const { data, error } = await adminClient()
    .from("risk_findings")
    .select("status, entitlement_id, title, resolution_type")
    .eq("tenant_id", tenantId)
    .eq("category", "rogue_access")
    .eq("account_id", accountId);
  if (error) throw new Error(`accessFindings: ${error.message}`);
  return (data ?? []).map((r) => ({ status: r.status, entitlementId: r.entitlement_id, title: r.title, resolutionType: r.resolution_type }));
}

export async function grantsOf(tenantId: string, accountId: string): Promise<{ entitlementId: string; revokedAt: string | null; missingFromSourceAt: string | null }[]> {
  const { data, error } = await adminClient()
    .from("access_grants")
    .select("entitlement_id, revoked_at, missing_from_source_at")
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId);
  if (error) throw new Error(`grantsOf: ${error.message}`);
  return (data ?? []).map((r) => ({ entitlementId: r.entitlement_id, revokedAt: r.revoked_at, missingFromSourceAt: r.missing_from_source_at }));
}

export async function entitlementIdByRef(tenantId: string, applicationId: string, ref: string): Promise<string | null> {
  const { data } = await adminClient().from("entitlements").select("id").eq("tenant_id", tenantId).eq("application_id", applicationId).eq("external_ref", ref).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** INTEGRATION-P0-20: which source set each field of an identity (not returned by the identity API). */
export async function fieldProvenanceOf(tenantId: string, identityId: string): Promise<Record<string, { sourceId: string; priority: number }>> {
  const { data, error } = await adminClient().from("identities").select("field_provenance").eq("tenant_id", tenantId).eq("id", identityId).single();
  if (error) throw new Error(`fieldProvenanceOf: ${error.message}`);
  return (data?.field_provenance ?? {}) as Record<string, { sourceId: string; priority: number }>;
}
