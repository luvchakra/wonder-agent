import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import {
  IDENTITY_TYPES,
  type Identity,
  type IdentityAttributeDefinition,
  type IdentityRelationship,
  type IdentityStatus,
  type IdentityType,
} from "@/lib/shared/types/agent-identity";
import {
  validateAttributeDefinition,
  validateAttributes,
  validateIdentityUpdate,
  validateNewIdentity,
  validateRelationshipInput,
  type AttributeDefinitionInput,
  type IdentityInput,
  type ValidIdentityFields,
} from "./identityRules";

/**
 * IDENTITY-P0-15/16/17 — the WonderID identity directory: every identity
 * of every type in one tenant-scoped reference table (`identities`,
 * migration 0077), its tenant-defined attributes and its relationships.
 *
 * Runs as the calling user (RLS admits the tenants they belong to), and
 * every read and write also filters on the one tenant resolved for the
 * request, because a person in two organizations would otherwise see both
 * (QA-P0-17). References to other identities go through same-tenant
 * composite foreign keys, so an id from another tenant fails as a 23503,
 * reported as not found.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toISOString().slice(0, 10);

type Row = Record<string, unknown>;

function toIdentity(r: Row): Identity {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    identityType: r.identity_type as IdentityType,
    subtype: (r.subtype as string | null) ?? null,
    displayName: r.display_name as string,
    username: (r.username as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    status: r.status as IdentityStatus,
    lifecycleState: (r.lifecycle_state as Identity["lifecycleState"]) ?? null,
    userId: (r.user_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    sourceSystem: (r.source_system as string | null) ?? null,
    sourceNativeId: (r.source_native_id as string | null) ?? null,
    correlationKey: (r.correlation_key as string | null) ?? null,
    ownerIdentityId: (r.owner_identity_id as string | null) ?? null,
    sponsorIdentityId: (r.sponsor_identity_id as string | null) ?? null,
    managerIdentityId: (r.manager_identity_id as string | null) ?? null,
    department: (r.department as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    businessUnit: (r.business_unit as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    employmentType: (r.employment_type as string | null) ?? null,
    organization: (r.organization as string | null) ?? null,
    purpose: (r.purpose as string | null) ?? null,
    startDate: (r.start_date as string | null) ?? null,
    endDate: (r.end_date as string | null) ?? null,
    riskScore: r.risk_score === null || r.risk_score === undefined ? null : Number(r.risk_score),
    privileged: Boolean(r.privileged),
    external: Boolean(r.external),
    attributes: (r.attributes as Record<string, unknown>) ?? {},
    createdBy: (r.created_by as string | null) ?? null,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toDefinition(r: Row): IdentityAttributeDefinition {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    identityType: (r.identity_type as IdentityType | null) ?? null,
    name: r.name as string,
    displayName: r.display_name as string,
    dataType: r.data_type as IdentityAttributeDefinition["dataType"],
    required: Boolean(r.required),
    sensitive: Boolean(r.sensitive),
    searchable: Boolean(r.searchable),
    uniqueValue: Boolean(r.unique_value),
    allowedValues: (r.allowed_values as string[]) ?? [],
    validationRegex: (r.validation_regex as string | null) ?? null,
    sourceMapping: (r.source_mapping as string | null) ?? null,
    active: Boolean(r.active),
    createdAt: r.created_at as string,
  };
}

function toRelationship(r: Row): IdentityRelationship {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    sourceIdentityId: r.source_identity_id as string,
    targetIdentityId: r.target_identity_id as string,
    relationshipType: r.relationship_type as IdentityRelationship["relationshipType"],
    validFrom: r.valid_from as string,
    validTo: (r.valid_to as string | null) ?? null,
    source: r.source as string,
    confidence: r.confidence as IdentityRelationship["confidence"],
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function toRow(f: ValidIdentityFields): Row {
  return {
    subtype: f.subtype,
    display_name: f.displayName,
    username: f.username,
    email: f.email,
    status: f.status,
    owner_identity_id: f.ownerIdentityId,
    sponsor_identity_id: f.sponsorIdentityId,
    manager_identity_id: f.managerIdentityId,
    department: f.department,
    title: f.title,
    business_unit: f.businessUnit,
    location: f.location,
    employment_type: f.employmentType,
    organization: f.organization,
    purpose: f.purpose,
    start_date: f.startDate,
    end_date: f.endDate,
    privileged: f.privileged,
    attributes: f.attributes,
  };
}

function writeError(error: { code?: string; message: string }, what: string): never {
  if (error.code === "23503") throw new ApiError(404, "NOT_FOUND", `A referenced identity was not found in this organization`);
  if (error.code === "23505") throw new ApiError(409, "CONFLICT", `${what} already exists`);
  if (error.code === "23514" || error.code === "22P02") throw new ApiError(400, "VALIDATION_FAILED", error.message);
  throw new ApiError(500, "WRITE_FAILED", error.message);
}

// ---------------------------------------------------------------- reads

export type IdentityListFilter = {
  types?: IdentityType[];
  status?: IdentityStatus;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type IdentityListRow = Pick<
  Identity,
  "id" | "identityType" | "subtype" | "displayName" | "email" | "status" | "lifecycleState" | "agentId" | "userId" | "department" | "organization" | "endDate" | "privileged" | "sourceSystem" | "riskScore" | "lastSeenAt"
> & { owner: { id: string; displayName: string } | null; sponsor: { id: string; displayName: string } | null };

const LIST_COLUMNS =
  "id, identity_type, subtype, display_name, email, status, lifecycle_state, agent_id, user_id, department, organization, end_date, privileged, source_system, risk_score, last_seen_at, owner_identity_id, sponsor_identity_id";

/** One page of the tenant's identities, newest name order, with the total. */
export async function listIdentities(tenantId: string, filter: IdentityListFilter = {}): Promise<{ rows: IdentityListRow[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const supabase = await supabaseServer();
  let query = supabase.from("identities").select(LIST_COLUMNS, { count: "exact" }).eq("tenant_id", tenantId);
  if (filter.types?.length) query = query.in("identity_type", filter.types);
  if (filter.status) query = query.eq("status", filter.status);
  const q = filter.q?.trim().replace(/[%_,()*\\]/g, " ").trim();
  if (q) query = query.or(`display_name.ilike.%${q}%,email.ilike.%${q}%,username.ilike.%${q}%`);
  const { data, error, count } = await query
    .order("display_name", { ascending: true })
    .order("id", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (data ?? []) as Row[];

  // Owner and sponsor names in one follow-up read, same tenant.
  const refIds = [...new Set(rows.flatMap((r) => [r.owner_identity_id, r.sponsor_identity_id]).filter(Boolean) as string[])];
  const names = new Map<string, string>();
  if (refIds.length) {
    const { data: refs, error: refError } = await supabase.from("identities").select("id, display_name").eq("tenant_id", tenantId).in("id", refIds);
    if (refError) throw new ApiError(500, "QUERY_FAILED", refError.message);
    for (const r of refs ?? []) names.set(r.id as string, r.display_name as string);
  }
  const ref = (id: unknown) => (typeof id === "string" && names.has(id) ? { id, displayName: names.get(id)! } : null);

  return {
    total: count ?? rows.length,
    rows: rows.map((r) => {
      const i = toIdentity({ ...r, tenant_id: tenantId });
      return {
        id: i.id,
        identityType: i.identityType,
        subtype: i.subtype,
        displayName: i.displayName,
        email: i.email,
        status: i.status,
        lifecycleState: i.lifecycleState,
        agentId: i.agentId,
        userId: i.userId,
        department: i.department,
        organization: i.organization,
        endDate: i.endDate,
        privileged: i.privileged,
        sourceSystem: i.sourceSystem,
        riskScore: i.riskScore,
        lastSeenAt: i.lastSeenAt,
        owner: ref(r.owner_identity_id),
        sponsor: ref(r.sponsor_identity_id),
      };
    }),
  };
}

/** How many identities of each type the tenant has (head counts, in parallel). */
export async function countIdentitiesByType(tenantId: string): Promise<Record<IdentityType, number>> {
  const supabase = await supabaseServer();
  const counts = await Promise.all(
    IDENTITY_TYPES.map(async (type) => {
      const { count, error } = await supabase
        .from("identities")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("identity_type", type);
      if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
      return [type, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<IdentityType, number>;
}

/** Identity health signals for the overview (IDENTITY-P0-17). */
export async function getIdentityHealth(tenantId: string): Promise<{ machinesWithoutOwner: number; externalsExpiringSoon: number; externalsExpired: number }> {
  const supabase = await supabaseServer();
  const now = today();
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const head = () => supabase.from("identities").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [orphans, expiring, expired] = await Promise.all([
    head().in("identity_type", ["MACHINE", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API"]).is("owner_identity_id", null).not("status", "in", "(terminated,archived)"),
    head().eq("identity_type", "EXTERNAL").eq("status", "active").gte("end_date", now).lte("end_date", soon),
    head().eq("identity_type", "EXTERNAL").eq("status", "active").lt("end_date", now),
  ]);
  for (const r of [orphans, expiring, expired]) if (r.error) throw new ApiError(500, "QUERY_FAILED", r.error.message);
  return { machinesWithoutOwner: orphans.count ?? 0, externalsExpiringSoon: expiring.count ?? 0, externalsExpired: expired.count ?? 0 };
}

export async function getIdentity(tenantId: string, identityId: string): Promise<Identity | null> {
  if (!UUID_RE.test(identityId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("identities").select().eq("tenant_id", tenantId).eq("id", identityId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toIdentity(data) : null;
}

/**
 * The person identity of a signed-in member (ACCESS-P0-18: who is asking,
 * and whose manager they are). Every active member has one, mirrored from
 * their membership (IDENTITY-P0-15). Null if none.
 */
export async function getIdentityForUser(tenantId: string, userId: string): Promise<Identity | null> {
  if (!UUID_RE.test(userId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("identities").select().eq("tenant_id", tenantId).eq("user_id", userId).eq("identity_type", "HUMAN").maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toIdentity(data) : null;
}

/** Names of the given identities in this tenant (for showing references). */
export async function getIdentityNames(tenantId: string, ids: string[]): Promise<Map<string, { displayName: string; identityType: IdentityType }>> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  const out = new Map<string, { displayName: string; identityType: IdentityType }>();
  if (!unique.length) return out;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("identities").select("id, display_name, identity_type").eq("tenant_id", tenantId).in("id", unique);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  for (const r of data ?? []) out.set(r.id as string, { displayName: r.display_name as string, identityType: r.identity_type as IdentityType });
  return out;
}

/** People who can be named owner, sponsor or manager: the tenant's active humans. */
export async function listAccountableHumans(tenantId: string): Promise<{ id: string; displayName: string; email: string | null }[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identities")
    .select("id, display_name, email")
    .eq("tenant_id", tenantId)
    .eq("identity_type", "HUMAN")
    .eq("status", "active")
    .order("display_name")
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => ({ id: r.id as string, displayName: r.display_name as string, email: (r.email as string | null) ?? null }));
}

// ---------------------------------------------------------------- writes

/**
 * Owner, sponsor and manager must be active HUMAN identities of this
 * tenant, and never the identity itself. Checked here so the refusal says
 * why; the composite foreign keys hold the tenant rule regardless.
 */
async function assertAccountableRefs(tenantId: string, fields: ValidIdentityFields, selfId: string | null): Promise<void> {
  const refs = (
    [
      ["ownerIdentityId", fields.ownerIdentityId],
      ["sponsorIdentityId", fields.sponsorIdentityId],
      ["managerIdentityId", fields.managerIdentityId],
    ] as const
  ).filter(([, id]) => id);
  if (!refs.length) return;
  for (const [field, id] of refs) if (id === selfId) throw new ApiError(400, "VALIDATION_FAILED", `${field}: an identity cannot be its own ${field.replace("IdentityId", "")}`);
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identities")
    .select("id, identity_type, status")
    .eq("tenant_id", tenantId)
    .in("id", refs.map(([, id]) => id!));
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const found = new Map((data ?? []).map((r) => [r.id as string, r]));
  for (const [field, id] of refs) {
    const row = found.get(id!);
    if (!row) throw new ApiError(404, "NOT_FOUND", `${field}: no such identity in this organization`);
    if (row.identity_type !== "HUMAN" || row.status !== "active") {
      throw new ApiError(400, "VALIDATION_FAILED", `${field}: must be an active person in this organization`);
    }
  }
}

async function activeDefinitions(tenantId: string): Promise<IdentityAttributeDefinition[]> {
  return (await listAttributeDefinitions(tenantId)).filter((d) => d.active);
}

/** A unique attribute's value may be held by one identity only. */
async function assertUniqueAttributes(tenantId: string, definitions: IdentityAttributeDefinition[], attributes: Record<string, unknown>, selfId: string | null) {
  const supabase = await supabaseServer();
  for (const def of definitions) {
    if (!def.uniqueValue || attributes[def.name] === undefined) continue;
    let query = supabase.from("identities").select("id").eq("tenant_id", tenantId).eq(`attributes->>${def.name}`, String(attributes[def.name])).limit(1);
    if (selfId) query = query.neq("id", selfId);
    const { data, error } = await query;
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    if (data?.length) throw new ApiError(409, "CONFLICT", `attributes.${def.name}: another identity already has this ${def.displayName}`);
  }
}

export async function createIdentity(tenantId: string, actorId: string, input: IdentityInput): Promise<Identity> {
  const fields = validateNewIdentity(input, today());
  const definitions = await activeDefinitions(tenantId);
  fields.attributes = validateAttributes(input.attributes, definitions, fields.identityType);
  await Promise.all([assertAccountableRefs(tenantId, fields, null), assertUniqueAttributes(tenantId, definitions, fields.attributes, null)]);

  const isPerson = fields.identityType === "HUMAN" || fields.identityType === "EXTERNAL";
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identities")
    .insert({
      tenant_id: tenantId,
      identity_type: fields.identityType,
      ...toRow(fields),
      external: fields.identityType === "EXTERNAL",
      lifecycle_state: isPerson ? (fields.startDate && fields.startDate > today() ? "PRE_JOIN" : "ACTIVE") : null,
      source_system: "manual",
      created_by: actorId,
    })
    .select()
    .single();
  if (error || !data) writeError(error ?? { message: "Failed to create identity" }, "An identity with this source reference");
  const identity = toIdentity(data);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.created",
    objectType: "identity",
    objectId: identity.id,
    outcome: "success",
    metadata: { identityType: identity.identityType, ownerIdentityId: identity.ownerIdentityId, sponsorIdentityId: identity.sponsorIdentityId },
  });
  return identity;
}

export async function updateIdentity(tenantId: string, actorId: string, identityId: string, patch: IdentityInput): Promise<Identity> {
  const current = await getIdentity(tenantId, identityId);
  if (!current) throw new ApiError(404, "NOT_FOUND", "No such identity in this organization");
  const { fields, changed } = validateIdentityUpdate(current, patch, today());
  const definitions = await activeDefinitions(tenantId);
  if (patch.attributes !== undefined) {
    fields.attributes = validateAttributes(patch.attributes, definitions, current.identityType);
    await assertUniqueAttributes(tenantId, definitions, fields.attributes, identityId);
  } else {
    fields.attributes = current.attributes;
  }
  await assertAccountableRefs(tenantId, fields, identityId);
  if (!changed.length) return current;

  const update: Row =
    current.identityType === "AI_AGENT"
      ? { owner_identity_id: fields.ownerIdentityId, sponsor_identity_id: fields.sponsorIdentityId, attributes: fields.attributes }
      : toRow(fields);
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identities")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", identityId)
    .select()
    .single();
  if (error || !data) writeError(error ?? { message: "Failed to update identity" }, "An identity with this source reference");
  const identity = toIdentity(data);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: changed.includes("status") ? "identity.status_changed" : "identity.updated",
    objectType: "identity",
    objectId: identityId,
    outcome: "success",
    // Field names only: values can be personal data (#10, §17.7).
    metadata: { identityType: identity.identityType, changed, ...(changed.includes("status") ? { from: current.status, to: identity.status } : {}) },
  });
  return identity;
}

// ---------------------------------------------------------------- relationships

export type RelationshipView = IdentityRelationship & {
  direction: "outgoing" | "incoming";
  other: { id: string; displayName: string; identityType: IdentityType } | null;
};

/** Every relationship the identity takes part in, current first. */
export async function listIdentityRelationships(tenantId: string, identityId: string): Promise<RelationshipView[]> {
  if (!UUID_RE.test(identityId)) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_relationships")
    .select()
    .eq("tenant_id", tenantId)
    .or(`source_identity_id.eq.${identityId},target_identity_id.eq.${identityId}`)
    .order("valid_from", { ascending: false })
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rels = (data ?? []).map(toRelationship);
  const names = await getIdentityNames(
    tenantId,
    rels.map((r) => (r.sourceIdentityId === identityId ? r.targetIdentityId : r.sourceIdentityId)),
  );
  return rels
    .map((r) => {
      const outgoing = r.sourceIdentityId === identityId;
      const otherId = outgoing ? r.targetIdentityId : r.sourceIdentityId;
      const other = names.get(otherId);
      return { ...r, direction: outgoing ? ("outgoing" as const) : ("incoming" as const), other: other ? { id: otherId, ...other } : null };
    })
    .sort((a, b) => Number(a.validTo !== null) - Number(b.validTo !== null));
}

export async function addIdentityRelationship(
  tenantId: string,
  actorId: string,
  input: { sourceIdentityId?: unknown; targetIdentityId?: unknown; relationshipType?: unknown; validTo?: unknown },
): Promise<IdentityRelationship> {
  const rel = validateRelationshipInput(input, new Date());
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_relationships")
    .insert({
      tenant_id: tenantId,
      source_identity_id: rel.sourceIdentityId,
      target_identity_id: rel.targetIdentityId,
      relationship_type: rel.relationshipType,
      valid_to: rel.validTo,
      source: "manual",
      confidence: "confirmed",
      created_by: actorId,
    })
    .select()
    .single();
  if (error || !data) writeError(error ?? { message: "Failed to add relationship" }, "This relationship");
  const relationship = toRelationship(data);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.relationship_added",
    objectType: "identity",
    objectId: rel.sourceIdentityId,
    outcome: "success",
    metadata: { relationshipId: relationship.id, relationshipType: rel.relationshipType, targetIdentityId: rel.targetIdentityId, validTo: rel.validTo },
  });
  return relationship;
}

/** Ends a current relationship; its history stays. */
export async function endIdentityRelationship(tenantId: string, actorId: string, relationshipId: string): Promise<void> {
  if (!UUID_RE.test(relationshipId)) throw new ApiError(404, "NOT_FOUND", "No such relationship");
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_relationships")
    .update({ valid_to: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", relationshipId)
    .is("valid_to", null)
    .select("id, source_identity_id, relationship_type");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data?.length) throw new ApiError(404, "NOT_FOUND", "No current relationship with that id");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.relationship_ended",
    objectType: "identity",
    objectId: data[0].source_identity_id as string,
    outcome: "success",
    metadata: { relationshipId, relationshipType: data[0].relationship_type },
  });
}

// ---------------------------------------------------------------- attribute definitions

export async function listAttributeDefinitions(tenantId: string): Promise<IdentityAttributeDefinition[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_attribute_definitions")
    .select()
    .eq("tenant_id", tenantId)
    .order("active", { ascending: false })
    .order("display_name");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toDefinition);
}

export async function createAttributeDefinition(tenantId: string, actorId: string, input: AttributeDefinitionInput): Promise<IdentityAttributeDefinition> {
  const d = validateAttributeDefinition(input);
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_attribute_definitions")
    .insert({
      tenant_id: tenantId,
      identity_type: d.identityType,
      name: d.name,
      display_name: d.displayName,
      data_type: d.dataType,
      required: d.required,
      sensitive: d.sensitive,
      searchable: d.searchable,
      unique_value: d.uniqueValue,
      allowed_values: d.allowedValues,
      validation_regex: d.validationRegex,
      source_mapping: d.sourceMapping,
      created_by: actorId,
    })
    .select()
    .single();
  if (error || !data) writeError(error ?? { message: "Failed to create attribute" }, `An attribute named ${d.name} for this identity type`);
  const definition = toDefinition(data);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.attribute_defined",
    objectType: "identity_attribute_definition",
    objectId: definition.id,
    outcome: "success",
    metadata: { name: d.name, identityType: d.identityType, dataType: d.dataType, required: d.required, sensitive: d.sensitive },
  });
  return definition;
}

/** Retires (or restores) an attribute. Values already stored are kept. */
export async function setAttributeDefinitionActive(tenantId: string, actorId: string, definitionId: string, active: boolean): Promise<void> {
  if (!UUID_RE.test(definitionId)) throw new ApiError(404, "NOT_FOUND", "No such attribute");
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_attribute_definitions")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", definitionId)
    .select("id, name");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data?.length) throw new ApiError(404, "NOT_FOUND", "No such attribute");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: active ? "identity.attribute_restored" : "identity.attribute_retired",
    objectType: "identity_attribute_definition",
    objectId: definitionId,
    outcome: "success",
    metadata: { name: data[0].name },
  });
}
