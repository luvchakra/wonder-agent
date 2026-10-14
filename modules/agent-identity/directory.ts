import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
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
import { changedFields, rowFromIdentity } from "./attributeRules";
import { applyIdentityRules } from "./identityRulesService";

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
    ref: r.ref === null || r.ref === undefined ? null : Number(r.ref),
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
  /** IDENTITY-P0-20: only machine, service account, workload, application and API identities with no owner. */
  unownedNonHuman?: boolean;
  status?: IdentityStatus;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type IdentityListRow = Pick<
  Identity,
  "id" | "ref" | "identityType" | "subtype" | "displayName" | "email" | "status" | "lifecycleState" | "agentId" | "userId" | "department" | "organization" | "endDate" | "privileged" | "sourceSystem" | "riskScore" | "lastSeenAt"
> & { owner: { id: string; displayName: string } | null; sponsor: { id: string; displayName: string } | null };

const LIST_COLUMNS =
  "id, ref, identity_type, subtype, display_name, email, status, lifecycle_state, agent_id, user_id, department, organization, end_date, privileged, source_system, risk_score, last_seen_at, owner_identity_id, sponsor_identity_id";

/** One page of the tenant's identities, newest name order, with the total. */
export async function listIdentities(tenantId: string, filter: IdentityListFilter = {}): Promise<{ rows: IdentityListRow[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const supabase = await supabaseServer();
  let query = supabase.from("identities").select(LIST_COLUMNS, { count: "exact" }).eq("tenant_id", tenantId);
  if (filter.types?.length) query = query.in("identity_type", filter.types);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.unownedNonHuman) {
    query = query.in("identity_type", ["MACHINE", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API"]).is("owner_identity_id", null).not("status", "in", "(terminated,archived)");
  }
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
        ref: i.ref,
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
export async function getIdentityNames(tenantId: string, ids: string[]): Promise<Map<string, { displayName: string; identityType: IdentityType; ref: number | null }>> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  const out = new Map<string, { displayName: string; identityType: IdentityType; ref: number | null }>();
  if (!unique.length) return out;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("identities").select("id, ref, display_name, identity_type").eq("tenant_id", tenantId).in("id", unique);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  for (const r of data ?? []) out.set(r.id as string, { displayName: r.display_name as string, identityType: r.identity_type as IdentityType, ref: r.ref === null || r.ref === undefined ? null : Number(r.ref) });
  return out;
}

/**
 * COMPLIANCE-P0-10: what an access review needs about the identities whose
 * access it covers (who they are, their sign-in user, manager and owner),
 * in batches. Service-role read filtered to the caller's tenant (§14); it
 * may run after the response, when no user session is at hand.
 */
export async function getIdentityReviewInfo(
  tenantId: string,
  ids: string[],
): Promise<Map<string, { displayName: string; identityType: IdentityType; userId: string | null; managerIdentityId: string | null; ownerIdentityId: string | null }>> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  const out = new Map<string, { displayName: string; identityType: IdentityType; userId: string | null; managerIdentityId: string | null; ownerIdentityId: string | null }>();
  for (let i = 0; i < unique.length; i += 500) {
    const { data, error } = await supabaseServiceRole()
      .from("identities")
      .select("id, tenant_id, display_name, identity_type, user_id, manager_identity_id, owner_identity_id")
      .eq("tenant_id", tenantId)
      .in("id", unique.slice(i, i + 500));
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    for (const r of data ?? []) {
      if (r.tenant_id !== tenantId) continue;
      out.set(r.id as string, {
        displayName: r.display_name as string,
        identityType: r.identity_type as IdentityType,
        userId: (r.user_id as string | null) ?? null,
        managerIdentityId: (r.manager_identity_id as string | null) ?? null,
        ownerIdentityId: (r.owner_identity_id as string | null) ?? null,
      });
    }
  }
  return out;
}

/**
 * COMPLIANCE-P0-11: each member's person identity in this organization
 * (user id → identity id), for reviews of their WonderID roles. Service
 * role, filtered by tenant.
 */
export async function getHumanIdentityIdsForUsers(tenantId: string, userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter((id) => UUID_RE.test(id)))];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 500) {
    const { data, error } = await supabaseServiceRole()
      .from("identities")
      .select("id, tenant_id, user_id")
      .eq("tenant_id", tenantId)
      .eq("identity_type", "HUMAN")
      .in("user_id", unique.slice(i, i + 500));
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    for (const r of data ?? []) if (r.tenant_id === tenantId && r.user_id) out.set(r.user_id as string, r.id as string);
  }
  return out;
}

export type SourceDisagreementRow = {
  id: string;
  identityId: string;
  displayName: string;
  /** The identity field, or `attributes.<name>` for a custom attribute. */
  field: string;
  keptValue: string | null;
  keptSourceId: string | null;
  otherValue: string | null;
  otherSourceId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** FOUNDATION-P0-34: the identity's number in URLs. */
  identityRef?: number | null;
};

/**
 * WID-H01 (owner decision): open disagreements between identity sources,
 * newest first. The higher-priority value is the one on the identity; the
 * other is what a lower-priority source sent. Read as the user (RLS),
 * filtered by tenant.
 */
export async function listSourceDisagreements(tenantId: string, limit = 100): Promise<SourceDisagreementRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_source_conflicts")
    .select("id, identity_id, field, kept_value, kept_source_id, other_value, other_source_id, first_seen_at, last_seen_at")
    .eq("tenant_id", tenantId)
    .is("resolved_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await getIdentityNames(tenantId, rows.map((r) => r.identity_id as string));
  return rows.map((r) => ({
    id: r.id as string,
    identityId: r.identity_id as string,
    displayName: names.get(r.identity_id as string)?.displayName ?? "Unknown identity",
    identityRef: names.get(r.identity_id as string)?.ref ?? null,
    field: r.field as string,
    keptValue: (r.kept_value as string | null) ?? null,
    keptSourceId: (r.kept_source_id as string | null) ?? null,
    otherValue: (r.other_value as string | null) ?? null,
    otherSourceId: r.other_source_id as string,
    firstSeenAt: r.first_seen_at as string,
    lastSeenAt: r.last_seen_at as string,
  }));
}

/**
 * ACCESS-P0-31: the active identities a person may request access for as
 * their owner: the non-human identities they own, and the AI agents they
 * are business owner of. Read as the user (RLS), filtered by tenant.
 */
export async function listOwnedIdentities(tenantId: string, userId: string, identityId: string | null): Promise<{ id: string; displayName: string; identityType: IdentityType; agentId: string | null }[]> {
  const supabase = await supabaseServer();
  const { data: owned, error: ownError } = await supabase
    .from("agent_owners")
    .select("agent_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("owner_type", "business_owner")
    .is("removed_at", null)
    .limit(200);
  if (ownError) throw new ApiError(500, "QUERY_FAILED", ownError.message);
  const agentIds = [...new Set((owned ?? []).map((o) => o.agent_id as string).filter((id) => UUID_RE.test(id)))];
  const either = [identityId && UUID_RE.test(identityId) ? `owner_identity_id.eq.${identityId}` : null, agentIds.length ? `agent_id.in.(${agentIds.join(",")})` : null].filter(Boolean);
  if (!either.length) return [];
  const { data, error } = await supabase
    .from("identities")
    .select("id, display_name, identity_type, agent_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("identity_type", ["MACHINE", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API", "AI_AGENT"])
    .or(either.join(","))
    .order("display_name")
    .limit(100);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => ({ id: r.id as string, displayName: r.display_name as string, identityType: r.identity_type as IdentityType, agentId: (r.agent_id as string | null) ?? null }));
}

/** EXPERIENCE-P0-29: the active people a person manages, for requesting on their behalf. Read as the user (RLS), filtered by tenant. */
export async function listDirectReports(
  tenantId: string,
  identityId: string | null,
): Promise<{ id: string; displayName: string; email: string | null; title: string | null; lifecycleState: Identity["lifecycleState"]; endDate: string | null }[]> {
  if (!identityId || !UUID_RE.test(identityId)) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identities")
    .select("id, display_name, email, title, lifecycle_state, end_date")
    .eq("tenant_id", tenantId)
    .eq("manager_identity_id", identityId)
    .eq("status", "active")
    .order("display_name")
    .limit(100);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    displayName: r.display_name as string,
    email: (r.email as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    lifecycleState: (r.lifecycle_state as Identity["lifecycleState"]) ?? null,
    endDate: (r.end_date as string | null) ?? null,
  }));
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

/**
 * Owner feedback 2026-10-14 — people the organization governs who cannot
 * sign in to WonderID yet: active person identities with an e-mail and no
 * membership (by user or by e-mail), for "Add user" to start from. Read as
 * the caller (RLS) with an explicit tenant filter; the membership read is
 * the service role, filtered by this tenant, and returns ids and e-mails only.
 */
export async function listPeopleWithoutAccess(tenantId: string): Promise<{ id: string; displayName: string; email: string; title: string | null; department: string | null }[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identities")
    .select("id, display_name, email, title, department, user_id")
    .eq("tenant_id", tenantId)
    .eq("identity_type", "HUMAN")
    .eq("status", "active")
    .not("email", "is", null)
    .order("display_name")
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const { data: members, error: memberError } = await supabaseServiceRole()
    .from("tenant_memberships")
    .select("tenant_id, user_id, users(email)")
    .eq("tenant_id", tenantId)
    .neq("status", "removed")
    .limit(5000);
  if (memberError) throw new ApiError(500, "QUERY_FAILED", memberError.message);
  const rows = ((members ?? []) as unknown as { tenant_id: string; user_id: string; users: { email: string | null } | null }[]).filter((m) => m.tenant_id === tenantId);
  const memberIds = new Set(rows.map((m) => m.user_id));
  const memberEmails = new Set(rows.map((m) => (m.users?.email ?? "").toLowerCase()).filter(Boolean));
  return (data ?? [])
    .filter((r) => !(r.user_id && memberIds.has(r.user_id as string)) && !memberEmails.has(String(r.email).toLowerCase()))
    .map((r) => ({ id: r.id as string, displayName: r.display_name as string, email: r.email as string, title: (r.title as string | null) ?? null, department: (r.department as string | null) ?? null }));
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
  // IDENTITY-P0-21: the organization's attribute rules, after the identity exists.
  const rules = await applyIdentityRules(tenantId, identity.id, { type: "identity.created" });
  return rules.changed ? ((await getIdentity(tenantId, identity.id)) ?? identity) : identity;
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
  // IDENTITY-P0-21: attribute rules on what changed. Their own writes start no further rules.
  const before = rowFromIdentity(current as unknown as Record<string, unknown>);
  const changedNames = changedFields(before, rowFromIdentity(identity as unknown as Record<string, unknown>));
  if (!changedNames.length) return identity;
  const rules = await applyIdentityRules(tenantId, identityId, { type: "identity.attribute_changed", changedAttributes: changedNames }, { before });
  return rules.changed ? ((await getIdentity(tenantId, identityId)) ?? identity) : identity;
}

// ---------------------------------------------------------------- relationships

export type RelationshipView = IdentityRelationship & {
  direction: "outgoing" | "incoming";
  other: { id: string; ref: number | null; displayName: string; identityType: IdentityType } | null;
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
