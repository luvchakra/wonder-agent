import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ApplicationEntitlementType, Entitlement } from "@/lib/shared/types/access-governance";
import { toEntitlement } from "./mappers";
import { typeName, validateEntitlementType, type EntitlementTypeInput, type TypeForRequest } from "./entitlementTypeRules";

/**
 * ACCESS-P0-33 (design §5.4) — an application's entitlement types, and the
 * governance fields on each entitlement (type, requestable, SOX-relevant).
 *
 * Reads run as the caller (RLS) with an explicit tenant filter. Writes use
 * the service role, because members cannot write these tables directly;
 * every statement filters on the tenant resolved for the request, and the
 * route checks access.manage first.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toType(r: Row): ApplicationEntitlementType {
  return {
    id: r.id as string,
    applicationId: r.application_id as string,
    name: r.name as string,
    requestMode: r.request_mode as ApplicationEntitlementType["requestMode"],
    certifiable: Boolean(r.certifiable),
    defaultDurationDays: (r.default_duration_days as number | null) ?? null,
    maxDurationDays: (r.max_duration_days as number | null) ?? null,
    requestPolicyId: (r.request_policy_id as string | null) ?? null,
    origin: r.origin as ApplicationEntitlementType["origin"],
  };
}

function writeError(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new ApiError(409, "CONFLICT", "This application already has a type with that name");
  if (error.code === "23503") throw new ApiError(404, "NOT_FOUND", "That application or request policy is not in this organization");
  if (error.code === "23514") throw new ApiError(400, "VALIDATION_FAILED", error.message);
  throw new ApiError(500, "WRITE_FAILED", error.message);
}

/** The application's entitlement types, with how many of its entitlements have each. */
export async function listEntitlementTypes(tenantId: string, applicationId: string): Promise<ApplicationEntitlementType[]> {
  if (!UUID_RE.test(applicationId)) return [];
  const supabase = await supabaseServer();
  const [types, ents] = await Promise.all([
    supabase.from("application_entitlement_types").select("*").eq("tenant_id", tenantId).eq("application_id", applicationId).order("name").limit(200),
    supabase.from("entitlements").select("entitlement_type").eq("tenant_id", tenantId).eq("application_id", applicationId).not("entitlement_type", "is", null).limit(10000),
  ]);
  if (types.error || ents.error) throw new ApiError(500, "QUERY_FAILED", (types.error ?? ents.error)!.message);
  const counts = new Map<string, number>();
  for (const e of ents.data ?? []) {
    const key = String(e.entitlement_type).toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return (types.data ?? []).map((r) => ({ ...toType(r), entitlementCount: counts.get(String(r.name).toLowerCase()) ?? 0 }));
}

async function assertApplication(tenantId: string, applicationId: string) {
  if (!UUID_RE.test(applicationId)) throw new ApiError(404, "NOT_FOUND", "No such application");
  const { data, error } = await supabaseServiceRole().from("applications").select("id, tenant_id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such application");
}

export async function createEntitlementType(tenantId: string, actorId: string, applicationId: string, input: EntitlementTypeInput): Promise<ApplicationEntitlementType> {
  await assertApplication(tenantId, applicationId);
  const v = validateEntitlementType(input, true);
  if ("error" in v) throw new ApiError(400, "VALIDATION_FAILED", v.error);
  const { data, error } = await supabaseServiceRole()
    .from("application_entitlement_types")
    .insert({ tenant_id: tenantId, application_id: applicationId, ...v, origin: "manual", created_by: actorId, updated_by: actorId })
    .select("*")
    .single();
  if (error || !data) writeError(error ?? { message: "Could not add the type" });
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.entitlement_type_created",
    objectType: "application",
    objectId: applicationId,
    outcome: "success",
    metadata: { typeId: data.id, ...v },
  });
  return toType(data);
}

export async function updateEntitlementType(tenantId: string, actorId: string, applicationId: string, typeId: string, input: EntitlementTypeInput): Promise<ApplicationEntitlementType> {
  if (!UUID_RE.test(typeId) || !UUID_RE.test(applicationId)) throw new ApiError(404, "NOT_FOUND", "No such type");
  const admin = supabaseServiceRole();
  const { data: current, error: readError } = await admin
    .from("application_entitlement_types")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .eq("id", typeId)
    .maybeSingle();
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  if (!current || current.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such type");
  // A connector's type keeps the connector's name, so the next import still matches it.
  if (current.origin === "connector" && input.name !== undefined && input.name !== current.name) throw new ApiError(400, "VALIDATION_FAILED", "name: a connector's type keeps its name");
  const v = validateEntitlementType(input, false, current as { default_duration_days: number | null; max_duration_days: number | null });
  if ("error" in v) throw new ApiError(400, "VALIDATION_FAILED", v.error);
  if (!Object.keys(v).length) return toType(current);
  const { data, error } = await admin
    .from("application_entitlement_types")
    .update({ ...v, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", typeId)
    .select("*")
    .single();
  if (error || !data) writeError(error ?? { message: "Could not save the type" });
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.entitlement_type_updated",
    objectType: "application",
    objectId: applicationId,
    outcome: "success",
    metadata: { typeId, changed: v },
  });
  return toType(data);
}

/**
 * Registers the types a connector sent (or a person named) for an
 * application, once each; existing ones and their settings are left alone.
 * The import calls it in its own system context, with the import's tenant.
 */
export async function registerConnectorTypes(tenantId: string, applicationId: string, names: (string | null | undefined)[], origin: "connector" | "manual" = "connector"): Promise<void> {
  const unique = [
    ...new Map(
      names
        .map(typeName)
        .filter((n): n is string => !!n)
        .map((n) => [n.toLowerCase(), n]),
    ).values(),
  ];
  if (!unique.length) return;
  const admin = supabaseServiceRole();
  const { data: existing, error } = await admin.from("application_entitlement_types").select("name").eq("tenant_id", tenantId).eq("application_id", applicationId);
  if (error) throw new Error(`entitlement types: ${error.message}`);
  const known = new Set((existing ?? []).map((r) => String(r.name).toLowerCase()));
  const fresh = unique.filter((n) => !known.has(n.toLowerCase()));
  if (!fresh.length) return;
  const { error: insertError } = await admin.from("application_entitlement_types").insert(fresh.map((name) => ({ tenant_id: tenantId, application_id: applicationId, name, origin })));
  // Another import registered it a moment ago: fine.
  if (insertError && insertError.code !== "23505") throw new Error(`entitlement types: ${insertError.message}`);
}

/** The type an entitlement's request must respect, if its application declares it. */
export async function typeForRequest(tenantId: string, applicationId: string, entitlementType: string | null): Promise<TypeForRequest> {
  if (!entitlementType) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("application_entitlement_types")
    .select("name, request_mode, default_duration_days, max_duration_days")
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .ilike(
      "name",
      entitlementType.replace(/[\\%_]/g, (c) => `\\${c}`),
    )
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;
  return {
    requestMode: data.request_mode as NonNullable<TypeForRequest>["requestMode"],
    defaultDurationDays: (data.default_duration_days as number | null) ?? null,
    maxDurationDays: (data.max_duration_days as number | null) ?? null,
  };
}

export type EntitlementGovernanceInput = { entitlementType?: unknown; requestable?: unknown; soxRelevant?: unknown };

/**
 * A person sets an entitlement's type, requestable or SOX-relevant flag.
 * Each field changed records manual provenance, so a classification rule
 * (ACCESS-P0-33 part 2) never overrides a person's decision.
 */
export async function setEntitlementGovernance(tenantId: string, actorId: string, entitlementId: string, input: EntitlementGovernanceInput): Promise<Entitlement> {
  if (!UUID_RE.test(entitlementId)) throw new ApiError(404, "ENTITLEMENT_NOT_FOUND");
  const set: Row = {};
  if (input.entitlementType !== undefined) {
    if (input.entitlementType !== null && input.entitlementType !== "" && !typeName(input.entitlementType)) throw new ApiError(400, "VALIDATION_FAILED", "entitlementType: a type name, or empty");
    set.entitlement_type = input.entitlementType ? typeName(input.entitlementType) : null;
  }
  for (const [key, col] of [
    ["requestable", "requestable"],
    ["soxRelevant", "sox_relevant"],
  ] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new ApiError(400, "VALIDATION_FAILED", `${key}: true or false`);
    set[col] = input[key];
  }
  if (!Object.keys(set).length) throw new ApiError(400, "VALIDATION_FAILED", "Nothing to change");
  const admin = supabaseServiceRole();
  const { data: current, error: readError } = await admin
    .from("entitlements")
    .select("id, tenant_id, application_id, field_provenance")
    .eq("tenant_id", tenantId)
    .eq("id", entitlementId)
    .maybeSingle();
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  if (!current || current.tenant_id !== tenantId) throw new ApiError(404, "ENTITLEMENT_NOT_FOUND");
  const at = new Date().toISOString();
  const provenance = { ...((current.field_provenance as Row) ?? {}) };
  for (const col of Object.keys(set)) provenance[col] = { by: "person", userId: actorId, at };
  const { data, error } = await admin
    .from("entitlements")
    .update({ ...set, field_provenance: provenance, updated_at: at })
    .eq("tenant_id", tenantId)
    .eq("id", entitlementId)
    .select("*")
    .single();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Could not save");
  // A type a person names is declared on the application too, so it can be governed.
  if (set.entitlement_type) await registerConnectorTypes(tenantId, current.application_id as string, [set.entitlement_type as string], "manual");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.entitlement_governance_set",
    objectType: "entitlement",
    objectId: entitlementId,
    outcome: "success",
    metadata: { changed: set },
  });
  return toEntitlement(data);
}
