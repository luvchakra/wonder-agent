import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import { DATA_SOURCE_KINDS, type DataSource, type DataSourceKind, type DataSourceWithReach } from "@/lib/shared/types/access-governance";

/**
 * ACCESS-P0-13 (master P0-11) — the data sources inventory. `data_sources`
 * has tenant-scoped client RLS like `applications` (migration 0070), so
 * every read and write runs as the calling user; the tenant is also
 * filtered explicitly (§14). Same-tenant references (a data source's
 * application, an entitlement's data source) are enforced by composite
 * foreign keys in the database, and checked here first for a clear error.
 * Creating, reclassifying and linking are audited (#11): a classification
 * change alters what an agent's CAN is judged against.
 */

type Row = {
  id: string;
  tenant_id: string;
  application_id: string | null;
  name: string;
  kind: DataSourceKind;
  classification: string | null;
  owner: string | null;
  description: string | null;
  external_ref: string | null;
  status: "active" | "retired";
  created_at: string;
  updated_at: string;
  applications?: { name: string } | null;
};

function toDataSource(row: Row): DataSource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    applicationId: row.application_id,
    applicationName: row.applications?.name ?? null,
    name: row.name,
    kind: row.kind,
    classification: row.classification,
    owner: row.owner,
    description: row.description,
    externalRef: row.external_ref,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type DataSourceInput = {
  name: string;
  kind: DataSourceKind;
  applicationId?: string | null;
  classification?: string | null;
  owner?: string | null;
  description?: string | null;
  externalRef?: string | null;
};

const LIMITS = { name: 200, classification: 100, owner: 200, description: 2000, externalRef: 500 } as const;

/** Validates untrusted input at the boundary; returns the clean value or throws 400. */
export function validateDataSourceInput(raw: unknown): DataSourceInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ApiError(400, "VALIDATION_FAILED", "body: must be a JSON object");
  const b = raw as Record<string, unknown>;
  const opt = (key: keyof typeof LIMITS): string | null => {
    const v = b[key];
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || v.trim().length > LIMITS[key]) throw new ApiError(400, "VALIDATION_FAILED", `${key}: must be text of at most ${LIMITS[key]} characters`);
    return v.trim();
  };
  const name = opt("name");
  if (!name) throw new ApiError(400, "VALIDATION_FAILED", "name: required");
  if (!DATA_SOURCE_KINDS.includes(b.kind as DataSourceKind)) throw new ApiError(400, "VALIDATION_FAILED", `kind: one of ${DATA_SOURCE_KINDS.join(", ")}`);
  const applicationId = b.applicationId === undefined || b.applicationId === null || b.applicationId === "" ? null : b.applicationId;
  if (applicationId !== null && (typeof applicationId !== "string" || !/^[0-9a-f-]{36}$/i.test(applicationId))) {
    throw new ApiError(400, "VALIDATION_FAILED", "applicationId: must be a UUID");
  }
  return {
    name,
    kind: b.kind as DataSourceKind,
    applicationId: applicationId as string | null,
    classification: opt("classification"),
    owner: opt("owner"),
    description: opt("description"),
    externalRef: opt("externalRef"),
  };
}

async function assertApplicationInTenant(tenantId: string, applicationId: string | null | undefined) {
  if (!applicationId) return;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("applications").select("id").eq("id", applicationId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) throw new ApiError(404, "APPLICATION_NOT_FOUND");
}

export async function createDataSource(tenantId: string, actorId: string, input: DataSourceInput): Promise<DataSource> {
  await assertApplicationInTenant(tenantId, input.applicationId);
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("data_sources")
    .insert({
      tenant_id: tenantId,
      application_id: input.applicationId ?? null,
      name: input.name,
      kind: input.kind,
      classification: input.classification ?? null,
      owner: input.owner ?? null,
      description: input.description ?? null,
      external_ref: input.externalRef ?? null,
    })
    .select("*, applications(name)")
    .single<Row>();
  if (error?.code === "23505") throw new ApiError(409, "DATA_SOURCE_EXISTS", "A data source with this name already exists");
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create data source");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.data_source_created",
    objectType: "data_source",
    objectId: data.id,
    outcome: "success",
    metadata: { name: data.name, kind: data.kind, classification: data.classification, applicationId: data.application_id },
  });
  return toDataSource(data);
}

/** Reclassify or retire. Records the before and after classification. */
export async function updateDataSource(
  tenantId: string,
  actorId: string,
  dataSourceId: string,
  change: { classification?: string | null; status?: "active" | "retired"; owner?: string | null },
): Promise<DataSource> {
  const supabase = await supabaseServer();
  const { data: before, error: readError } = await supabase.from("data_sources").select("classification, status").eq("id", dataSourceId).eq("tenant_id", tenantId).maybeSingle();
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  if (!before) throw new ApiError(404, "DATA_SOURCE_NOT_FOUND");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (change.classification !== undefined) {
    if (change.classification !== null && (typeof change.classification !== "string" || change.classification.length > LIMITS.classification)) {
      throw new ApiError(400, "VALIDATION_FAILED", "classification: text of at most 100 characters");
    }
    patch.classification = change.classification?.trim() || null;
  }
  if (change.status !== undefined) {
    if (change.status !== "active" && change.status !== "retired") throw new ApiError(400, "VALIDATION_FAILED", "status: active or retired");
    patch.status = change.status;
  }
  if (change.owner !== undefined) patch.owner = change.owner?.trim().slice(0, LIMITS.owner) || null;

  const { data, error } = await supabase
    .from("data_sources")
    .update(patch)
    .eq("id", dataSourceId)
    .eq("tenant_id", tenantId)
    .select("*, applications(name)")
    .single<Row>();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to update data source");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.data_source_updated",
    objectType: "data_source",
    objectId: dataSourceId,
    outcome: "success",
    metadata: { before, after: { classification: data.classification, status: data.status } },
  });
  return toDataSource(data);
}

/** Points an entitlement at the data source it opens (or clears it with null). */
export async function linkEntitlementToDataSource(tenantId: string, actorId: string, entitlementId: string, dataSourceId: string | null): Promise<void> {
  const supabase = await supabaseServer();
  if (dataSourceId) {
    const { data, error } = await supabase.from("data_sources").select("id").eq("id", dataSourceId).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    if (!data) throw new ApiError(404, "DATA_SOURCE_NOT_FOUND");
  }
  const { data, error } = await supabase
    .from("entitlements")
    .update({ data_source_id: dataSourceId })
    .eq("id", entitlementId)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "ENTITLEMENT_NOT_FOUND");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.entitlement_data_source_linked",
    objectType: "entitlement",
    objectId: entitlementId,
    outcome: "success",
    metadata: { dataSourceId },
  });
}

type ReachRow = { id: string; data_source_id: string; access_grants: Array<{ revoked_at: string | null; accounts: { agent_id: string | null } | null }> };

/** Pure: per data source, how many entitlements open it and which agents currently hold one. */
export function reachByDataSource(rows: ReachRow[]): Map<string, { entitlementCount: number; agentIds: string[] }> {
  const out = new Map<string, { entitlementCount: number; agents: Set<string> }>();
  for (const e of rows) {
    const entry = out.get(e.data_source_id) ?? { entitlementCount: 0, agents: new Set<string>() };
    entry.entitlementCount += 1;
    for (const g of e.access_grants ?? []) {
      if (g.revoked_at === null && g.accounts?.agent_id) entry.agents.add(g.accounts.agent_id);
    }
    out.set(e.data_source_id, entry);
  }
  return new Map([...out].map(([k, v]) => [k, { entitlementCount: v.entitlementCount, agentIds: [...v.agents].sort() }]));
}

/** The inventory, with reach (CAN), in two parallel queries. */
export async function listDataSources(tenantId: string): Promise<DataSourceWithReach[]> {
  const supabase = await supabaseServer();
  const [sources, reach] = await Promise.all([
    supabase.from("data_sources").select("*, applications(name)").eq("tenant_id", tenantId).order("name").limit(DEFAULT_LIST_LIMIT).returns<Row[]>(),
    supabase
      .from("entitlements")
      .select("id, data_source_id, access_grants(revoked_at, accounts(agent_id))")
      .eq("tenant_id", tenantId)
      .not("data_source_id", "is", null)
      .limit(5000)
      .returns<ReachRow[]>(),
  ]);
  if (sources.error) throw new ApiError(500, "QUERY_FAILED", sources.error.message);
  if (reach.error) throw new ApiError(500, "QUERY_FAILED", reach.error.message);
  const byId = reachByDataSource(reach.data ?? []);
  return (sources.data ?? []).map((row) => ({ ...toDataSource(row), entitlementCount: byId.get(row.id)?.entitlementCount ?? 0, agentIds: byId.get(row.id)?.agentIds ?? [] }));
}
