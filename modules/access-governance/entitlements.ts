import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { getIdentity } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { Entitlement, PrivilegeLevel } from "@/lib/shared/types/access-governance";
import { toEntitlement } from "./mappers";

/** ACCESS-P0-01.1. Client-facing tenant-scoped RLS (migration 0027). */
export async function createEntitlement(
  tenantId: string,
  applicationId: string,
  name: string,
  dataClassification?: string,
  privilegeLevel: PrivilegeLevel = "standard",
  entitlementType?: unknown,
): Promise<Entitlement> {
  if (!name.trim()) throw new ApiError(400, "INVALID_INPUT", "name is required");
  const supabase = await supabaseServer();
  // Owner feedback 2026-10-14: an entitlement added under a type names one of
  // the application's own entitlement types (read as the caller, under RLS).
  let typeName: string | null = null;
  if (entitlementType !== undefined && entitlementType !== null && entitlementType !== "") {
    const wanted = typeof entitlementType === "string" ? entitlementType.trim().toLowerCase() : "";
    const { data: types, error: typeError } = await supabase.from("application_entitlement_types").select("name, status").eq("tenant_id", tenantId).eq("application_id", applicationId).limit(200);
    if (typeError) throw new ApiError(500, "QUERY_FAILED", typeError.message);
    const found = ((types ?? []) as { name: string; status: string }[]).find((t) => t.name.toLowerCase() === wanted);
    if (!found) throw new ApiError(400, "VALIDATION_FAILED", "entitlementType: one of this application's entitlement types");
    if (found.status === "inactive") throw new ApiError(409, "TYPE_DISABLED", "That entitlement type is disabled");
    typeName = found.name;
  }
  const { data, error } = await supabase
    .from("entitlements")
    .insert({
      tenant_id: tenantId,
      application_id: applicationId,
      name,
      data_classification: dataClassification ?? null,
      privilege_level: privilegeLevel,
      ...(typeName ? { entitlement_type: typeName } : {}),
    })
    .select()
    .single();
  // QA-P0-17: 0076's same-tenant foreign keys refuse a reference to another
  // organization's row (23503). Say so, rather than a generic 500.
  if (error?.code === "23503") throw new ApiError(404, "NOT_FOUND", "That application is not in this organization");
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create entitlement");
  // ACCESS-P0-33: a hand-made entitlement is classified like an imported one.
  const { classifyEntitlements } = await import("./classificationRulesService");
  const classified = await classifyEntitlements(tenantId, [{ entitlementId: data.id as string, trigger: "entitlement.imported" }]);
  if (classified.changed) {
    const again = await getEntitlement(tenantId, data.id as string);
    if (again) return again;
  }
  return toEntitlement(data);
}

export async function getEntitlement(tenantId: string, entitlementId: string): Promise<Entitlement | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("entitlements").select().eq("id", entitlementId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toEntitlement(data) : null;
}

export async function listEntitlementsForApplication(
  tenantId: string,
  applicationId: string,
): Promise<Entitlement[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("entitlements")
    .select()
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toEntitlement);
}

/**
 * OPERATIONS-P0-03.1's "entitlement" search object type — the tenant-wide
 * counterpart to `listEntitlementsForApplication()` above, same reasoning
 * as Identity Agent's `listOwnersForTenant()`/`listIdentitiesForTenant()`:
 * the embed is a real FK (`entitlements.application_id -> applications(id)`).
 */
export type EntitlementWithContext = Entitlement & { applicationName: string };

export async function listEntitlementsForTenant(tenantId: string): Promise<EntitlementWithContext[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("entitlements")
    .select("*, applications(name)")
    .eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((row: Record<string, unknown> & { applications: { name: string } | null }) => ({
    ...toEntitlement(row),
    applicationName: row.applications?.name ?? "",
  }));
}

/** LIKE wildcards in a search match only themselves. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Every entitlement in the organization, with its application, a page at a
 * time (the Admin › Entitlements list, owner request 2026-10-10). Paged and
 * counted at the database (§15); the search is one escaped `ilike` on the
 * name, never a string-built filter.
 */
export async function listEntitlementInventory(
  tenantId: string,
  { q = "", page = 1, pageSize = 50 }: { q?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: (EntitlementWithContext & { applicationDisplayName: string | null; applicationRef: number | null })[]; total: number }> {
  const supabase = await supabaseServer();
  const size = Math.min(Math.max(pageSize, 1), 200);
  const from = (Math.max(page, 1) - 1) * size;
  let query = supabase
    .from("entitlements")
    .select("*, applications(name, display_name, ref)", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + size - 1);
  const term = q.trim().slice(0, 100);
  if (term) query = query.ilike("name", `%${escapeLike(term)}%`);
  const { data, error, count } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (data ?? []).map((row: Record<string, unknown> & { applications: { name: string; display_name: string | null; ref: number | null } | null }) => ({
    ...toEntitlement(row),
    applicationName: row.applications?.name ?? "",
    applicationDisplayName: row.applications?.display_name ?? null,
    applicationRef: row.applications?.ref ?? null,
  }));
  return { rows, total: count ?? rows.length };
}

/**
 * ACCESS-P0-19 — names the person who approves requests for this
 * entitlement (ahead of the application's business owner), or clears it
 * with null. The owner must be an active person of this organization.
 */
export async function setEntitlementOwner(tenantId: string, actorId: string, entitlementId: string, ownerIdentityId: string | null): Promise<Entitlement> {
  if (ownerIdentityId) {
    const owner = await getIdentity(tenantId, ownerIdentityId);
    if (!owner) throw new ApiError(404, "NOT_FOUND", "ownerIdentityId: that identity is not in this organization");
    if (owner.identityType !== "HUMAN" || owner.status !== "active") throw new ApiError(400, "VALIDATION_FAILED", "ownerIdentityId: an active person");
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("entitlements")
    .update({ owner_identity_id: ownerIdentityId })
    .eq("id", entitlementId)
    .eq("tenant_id", tenantId)
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "ENTITLEMENT_NOT_FOUND");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.entitlement_owner_set", objectType: "entitlement", objectId: entitlementId, outcome: "success", metadata: { ownerIdentityId } });
  return toEntitlement(data);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EntitlementForReview = {
  id: string;
  name: string;
  displayName: string | null;
  privilegeLevel: string | null;
  riskLevel: string | null;
  ownerIdentityId: string | null;
};

/**
 * COMPLIANCE-P0-10 part 4: the active applications (or one) with their
 * business owner and their active, certifiable entitlements, for an owner
 * review of each application's catalog. Service role (a campaign builds
 * after the response), filtered by tenant on every read (§14).
 */
export async function listApplicationsForReview(
  tenantId: string,
  applicationId: string | null = null,
): Promise<{ id: string; ref: number | null; name: string; ownerIdentityId: string | null; entitlements: EntitlementForReview[] }[]> {
  if (applicationId && !UUID.test(applicationId)) throw new ApiError(404, "APPLICATION_NOT_FOUND", "No such application");
  const admin = supabaseServiceRole();
  let query = admin.from("applications").select("id, tenant_id, ref, name, display_name, business_owner_identity_id").eq("tenant_id", tenantId).eq("onboarding_status", "ACTIVE");
  if (applicationId) query = query.eq("id", applicationId);
  const { data: apps, error } = await query.order("name").limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (apps ?? []).filter((a) => a.tenant_id === tenantId);
  if (!rows.length) return [];
  const { data: ents, error: entError } = await admin
    .from("entitlements")
    .select("id, tenant_id, application_id, name, display_name, privilege_level, risk_level, owner_identity_id")
    .eq("tenant_id", tenantId)
    .in("application_id", rows.map((a) => a.id as string))
    .eq("status", "active")
    .eq("certifiable", true)
    .order("name")
    .limit(5000);
  if (entError) throw new ApiError(500, "QUERY_FAILED", entError.message);
  const byApp = new Map<string, EntitlementForReview[]>();
  for (const e of ents ?? []) {
    if (e.tenant_id !== tenantId) continue;
    const list = byApp.get(e.application_id as string) ?? [];
    list.push({
      id: e.id as string,
      name: e.name as string,
      displayName: (e.display_name as string | null) ?? null,
      privilegeLevel: (e.privilege_level as string | null) ?? null,
      riskLevel: (e.risk_level as string | null) ?? null,
      ownerIdentityId: (e.owner_identity_id as string | null) ?? null,
    });
    byApp.set(e.application_id as string, list);
  }
  return rows.map((a) => ({
    id: a.id as string,
    ref: (a.ref as number | null) ?? null,
    name: ((a.display_name as string | null) || (a.name as string)) ?? "",
    ownerIdentityId: (a.business_owner_identity_id as string | null) ?? null,
    entitlements: byApp.get(a.id as string) ?? [],
  }));
}
