import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { Application, ApplicationOnboardingStatus, ApplicationType, CatalogLevel } from "@/lib/shared/types/access-governance";
import { getIdentity, getIdentityNames } from "@/modules/agent-identity/service";
import { toApplication } from "./mappers";
import { validateApplicationInput, type ApplicationInput } from "./applicationCatalogRules";

/**
 * ACCESS-P0-15 — the application catalog over the existing `applications`
 * table. Runs as the calling user (RLS), with an explicit tenant filter on
 * every statement (QA-P0-17). Owners are WonderID identities, read through
 * the Identity module's published contract (#6).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CatalogFilter = {
  q?: string;
  status?: ApplicationOnboardingStatus;
  appType?: ApplicationType;
  riskLevel?: CatalogLevel;
  missingOwner?: boolean;
  page?: number;
  pageSize?: number;
};

export type CatalogRow = Application & {
  businessOwnerName: string | null;
  technicalOwnerName: string | null;
  accountCount: number;
  entitlementCount: number;
};

async function withNames(tenantId: string, rows: (Application & { accountCount: number; entitlementCount: number })[]): Promise<CatalogRow[]> {
  const names = await getIdentityNames(
    tenantId,
    rows.flatMap((r) => [r.businessOwnerIdentityId, r.technicalOwnerIdentityId]).filter(Boolean) as string[],
  );
  return rows.map((r) => ({
    ...r,
    businessOwnerName: r.businessOwnerIdentityId ? (names.get(r.businessOwnerIdentityId)?.displayName ?? null) : null,
    technicalOwnerName: r.technicalOwnerIdentityId ? (names.get(r.technicalOwnerIdentityId)?.displayName ?? null) : null,
  }));
}

/** One page of the catalog, with account and entitlement counts (§15). */
export async function listApplicationCatalog(tenantId: string, filter: CatalogFilter = {}): Promise<{ rows: CatalogRow[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const supabase = await supabaseServer();
  let query = supabase.from("applications").select("*, accounts(count), entitlements(count)", { count: "exact" }).eq("tenant_id", tenantId);
  if (filter.status) query = query.eq("onboarding_status", filter.status);
  if (filter.appType) query = query.eq("app_type", filter.appType);
  if (filter.riskLevel) query = query.eq("risk_level", filter.riskLevel);
  if (filter.missingOwner) query = query.or("business_owner_identity_id.is.null,technical_owner_identity_id.is.null");
  const q = filter.q?.trim().replace(/[%_,()*\\]/g, " ").trim();
  if (q) query = query.or(`name.ilike.%${q}%,display_name.ilike.%${q}%,vendor.ilike.%${q}%,category.ilike.%${q}%`);
  const { data, error, count } = await query.order("name").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (data ?? []).map((r) => ({
    ...toApplication(r),
    accountCount: Number((r.accounts as { count: number }[] | null)?.[0]?.count ?? 0),
    entitlementCount: Number((r.entitlements as { count: number }[] | null)?.[0]?.count ?? 0),
  }));
  return { rows: await withNames(tenantId, rows), total: count ?? rows.length };
}

/** Catalog health for the inventory header, as head counts in parallel. */
export async function getCatalogSummary(tenantId: string) {
  const supabase = await supabaseServer();
  const head = () => supabase.from("applications").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [all, active, onboarding, missingOwner, highRisk] = await Promise.all([
    head(),
    head().eq("onboarding_status", "ACTIVE"),
    head().in("onboarding_status", ["DISCOVERED", "CONFIGURING", "CONNECTED", "VALIDATING", "SIMULATION_FAILED", "READY_FOR_APPROVAL", "APPROVED"]),
    head().not("onboarding_status", "eq", "RETIRED").or("business_owner_identity_id.is.null,technical_owner_identity_id.is.null"),
    head().in("risk_level", ["high", "critical"]),
  ]);
  for (const r of [all, active, onboarding, missingOwner, highRisk]) if (r.error) throw new ApiError(500, "QUERY_FAILED", r.error.message);
  return { total: all.count ?? 0, active: active.count ?? 0, onboarding: onboarding.count ?? 0, missingOwner: missingOwner.count ?? 0, highRisk: highRisk.count ?? 0 };
}

export async function getApplicationDetail(tenantId: string, applicationId: string): Promise<CatalogRow | null> {
  if (!UUID_RE.test(applicationId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("applications")
    .select("*, accounts(count), entitlements(count)")
    .eq("tenant_id", tenantId)
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;
  const [row] = await withNames(tenantId, [
    {
      ...toApplication(data),
      accountCount: Number((data.accounts as { count: number }[] | null)?.[0]?.count ?? 0),
      entitlementCount: Number((data.entitlements as { count: number }[] | null)?.[0]?.count ?? 0),
    },
  ]);
  return row;
}

/** Owners are active people of this organization (#4). */
async function assertOwners(tenantId: string, row: Record<string, unknown>) {
  for (const column of ["business_owner_identity_id", "technical_owner_identity_id"]) {
    const id = row[column];
    if (typeof id !== "string") continue;
    const identity = await getIdentity(tenantId, id);
    if (!identity) throw new ApiError(404, "NOT_FOUND", `${column === "business_owner_identity_id" ? "businessOwner" : "technicalOwner"}: no such identity in this organization`);
    if (identity.identityType !== "HUMAN" || identity.status !== "active") {
      throw new ApiError(400, "VALIDATION_FAILED", `${column === "business_owner_identity_id" ? "businessOwner" : "technicalOwner"}: must be an active person`);
    }
  }
}

function writeError(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new ApiError(409, "CONFLICT", "An application with this name already exists");
  if (error.code === "23503") throw new ApiError(404, "NOT_FOUND", "A referenced identity or integration is not in this organization");
  if (error.code === "23514") throw new ApiError(400, "VALIDATION_FAILED", error.message);
  throw new ApiError(500, "WRITE_FAILED", error.message);
}

/** Registers an application by hand; it starts DISCOVERED (ACCESS-P0-16 onboards it). */
export async function registerApplication(tenantId: string, actorId: string, input: ApplicationInput): Promise<Application> {
  const row = validateApplicationInput(input, { partial: false });
  await assertOwners(tenantId, row);
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("applications")
    .insert({ tenant_id: tenantId, ...row, onboarding_status: "DISCOVERED", discovery_source: "manual" })
    .select()
    .single();
  if (error || !data) writeError(error ?? { message: "Failed to register the application" });
  const app = toApplication(data);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "application.registered",
    objectType: "application",
    objectId: app.id,
    outcome: "success",
    metadata: { name: app.name, appType: app.appType, environment: app.environment, riskLevel: app.riskLevel },
  });
  return app;
}

export async function updateApplication(tenantId: string, actorId: string, applicationId: string, input: ApplicationInput): Promise<Application> {
  if (!UUID_RE.test(applicationId)) throw new ApiError(404, "NOT_FOUND", "No such application");
  const row = validateApplicationInput(input, { partial: true });
  if (!Object.keys(row).length) throw new ApiError(400, "VALIDATION_FAILED", "Nothing to change");
  await assertOwners(tenantId, row);
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("applications")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", applicationId)
    .select()
    .maybeSingle();
  if (error) writeError(error);
  if (!data) throw new ApiError(404, "NOT_FOUND", "No such application");
  const app = toApplication(data);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "application.updated",
    objectType: "application",
    objectId: app.id,
    outcome: "success",
    metadata: { changed: Object.keys(row) },
  });
  return app;
}
