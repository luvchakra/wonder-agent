import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AccessRequest } from "@/lib/shared/types/access-governance";
import { getAgentContract, getIdentity, getIdentityForUser, getIdentityNames, listOwners } from "@/modules/agent-identity/service";
import { classifyAccessGrant } from "./comparison";
import { toAccessRequest } from "./mappers";
import { startApprovalChain } from "./approvals";
import { approvalOutcome, assessRisk, evaluateRequest, resolvePolicy, validatePolicyInput, type RequestPolicy, type RiskLevel } from "./requestRules";
import { pendRequest } from "./pendingGrants";
import { enforceSoD } from "./sod";
import { entitlementRequestRules } from "./entitlementTypeRules";
import { typeForRequest } from "./entitlementTypes";

/**
 * ACCESS-P0-18 — the self-service request catalog (spec §11): request
 * policies, the catalog of requestable applications and entitlements, and
 * requests for oneself or others. Policy evaluation is deterministic
 * (`requestRules.ts`). Reads run as the user (RLS) with an explicit tenant
 * filter; policies and identity requests are written with the service
 * role (members have no write policy that fits: an automatically approved
 * request is not 'pending'), always filtered by the tenant resolved from
 * the session, and audited.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


function toPolicy(r: Record<string, unknown>): RequestPolicy {
  return {
    id: r.id as string,
    name: r.name as string,
    applicationId: (r.application_id as string | null) ?? null,
    entitlementId: (r.entitlement_id as string | null) ?? null,
    requestable: Boolean(r.requestable),
    allowSelf: Boolean(r.allow_self),
    allowForOthers: r.allow_for_others as RequestPolicy["allowForOthers"],
    maxDurationDays: (r.max_duration_days as number | null) ?? null,
    defaultDurationDays: (r.default_duration_days as number | null) ?? null,
    justificationRequired: Boolean(r.justification_required),
    riskThreshold: r.risk_threshold as RiskLevel,
    autoApprove: Boolean(r.auto_approve),
    approval: r.approval as RequestPolicy["approval"],
    approvalMode: ((r.approval_mode as string | null) ?? "sequential") as RequestPolicy["approvalMode"],
    approvalTimeoutDays: (r.approval_timeout_days as number | null) ?? 5,
    onTimeout: ((r.on_timeout as string | null) ?? "escalate") as RequestPolicy["onTimeout"],
    status: r.status as RequestPolicy["status"],
  };
}

export type PolicyRow = RequestPolicy & { applicationName: string | null; entitlementName: string | null; updatedAt: string };

export async function listRequestPolicies(tenantId: string): Promise<PolicyRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("access_request_policies")
    .select("*, applications(name, display_name), entitlements(name)")
    .eq("tenant_id", tenantId)
    .order("created_at")
    .limit(1000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => {
    const app = r.applications as { name: string; display_name: string | null } | null;
    return { ...toPolicy(r), applicationName: app ? (app.display_name ?? app.name) : null, entitlementName: (r.entitlements as { name: string } | null)?.name ?? null, updatedAt: r.updated_at as string };
  });
}

/** Creates a policy for a scope, or updates the one that scope already has. */
export async function saveRequestPolicy(tenantId: string, actorId: string, input: Record<string, unknown>): Promise<RequestPolicy> {
  const applicationId = typeof input.applicationId === "string" && input.applicationId ? input.applicationId : null;
  const entitlementId = typeof input.entitlementId === "string" && input.entitlementId ? input.entitlementId : null;
  if ((applicationId && !UUID_RE.test(applicationId)) || (entitlementId && !UUID_RE.test(entitlementId))) throw new ApiError(400, "VALIDATION_FAILED", "applicationId / entitlementId: ids");
  if (entitlementId && !applicationId) throw new ApiError(400, "VALIDATION_FAILED", "applicationId: required with an entitlement");
  const admin = supabaseServiceRole();
  let existingQuery = admin.from("access_request_policies").select("id").eq("tenant_id", tenantId);
  existingQuery = applicationId ? existingQuery.eq("application_id", applicationId) : existingQuery.is("application_id", null);
  existingQuery = entitlementId ? existingQuery.eq("entitlement_id", entitlementId) : existingQuery.is("entitlement_id", null);
  const { data: existing, error: exError } = await existingQuery.maybeSingle();
  if (exError) throw new ApiError(500, "QUERY_FAILED", exError.message);
  const fields = validatePolicyInput(input, Boolean(existing));
  const now = new Date().toISOString();
  const { data, error } = existing
    ? await admin.from("access_request_policies").update({ ...fields, updated_at: now }).eq("tenant_id", tenantId).eq("id", existing.id).select().single()
    : await admin
        .from("access_request_policies")
        .insert({ tenant_id: tenantId, application_id: applicationId, entitlement_id: entitlementId, ...fields, created_by: actorId })
        .select()
        .single();
  // Same-tenant keys refuse another organization's application or entitlement.
  if (error?.code === "23503") throw new ApiError(404, "NOT_FOUND", "That application or entitlement is not in this organization");
  if (error?.code === "23514") throw new ApiError(400, "VALIDATION_FAILED", error.message);
  if (error || !data) throw new ApiError(500, "WRITE_FAILED", error?.message ?? "Could not save the policy");
  const policy = toPolicy(data);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: existing ? "access.request_policy_updated" : "access.request_policy_created",
    objectType: "access_request_policy",
    objectId: policy.id,
    outcome: "success",
    metadata: { applicationId, entitlementId, ...fields },
  });
  return policy;
}

// ---------------------------------------------------------------- catalog

export type Approval = ReturnType<typeof approvalOutcome>;
export type CatalogEntitlement = { id: string; name: string; privilegeLevel: string; dataClassification: string | null; risk: RiskLevel; requestable: boolean; approval: Approval; policy: RequestPolicy | null };
export type CatalogItem = {
  applicationId: string;
  name: string;
  /** ACCESS-P0-31: its name and display name, which an agent contract may name. */
  names: string[];
  description: string | null;
  vendor: string | null;
  risk: RiskLevel;
  requestable: boolean;
  /** Requesting the application itself (no entitlement). */
  appRequestable: boolean;
  approval: Approval;
  policy: RequestPolicy | null;
  entitlements: CatalogEntitlement[];
};

/**
 * What can be requested: live (ACTIVE) applications, each with its
 * entitlements, the policy that governs each, and the assessed risk. Paged
 * by application at the database; one query for the page's entitlements.
 */
export async function listRequestCatalog(tenantId: string, filter: { q?: string; page?: number; pageSize?: number; applicationId?: string; requestableOnly?: boolean } = {}): Promise<{ items: CatalogItem[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 20, 1), 50);
  const page = Math.max(filter.page ?? 1, 1);
  const supabase = await supabaseServer();
  let query = supabase
    .from("applications")
    .select("id, name, display_name, description, vendor, risk_level, data_classification", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("onboarding_status", "ACTIVE");
  if (filter.applicationId) query = query.eq("id", UUID_RE.test(filter.applicationId) ? filter.applicationId : "00000000-0000-0000-0000-000000000000");
  const q = filter.q?.trim().replace(/[%_,()*\\]/g, " ").trim();
  if (q) query = query.or(`name.ilike.%${q}%,display_name.ilike.%${q}%,vendor.ilike.%${q}%,description.ilike.%${q}%`);
  const policies = await listRequestPolicies(tenantId);
  // Requestable only: unless an active tenant default makes everything
  // requestable, narrow to applications an active policy makes requestable
  // (itself or one of its entitlements) — in the query, so paging holds.
  if (filter.requestableOnly && !policies.some((p) => p.status === "active" && p.requestable && !p.applicationId)) {
    const requestableIds = [...new Set(policies.filter((p) => p.status === "active" && p.requestable && p.applicationId).map((p) => p.applicationId as string))];
    if (!requestableIds.length) return { items: [], total: 0 };
    query = query.in("id", requestableIds);
  }
  const { data: apps, error, count } = await query.order("name").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const ids = (apps ?? []).map((a) => a.id as string);
  const { data: ents, error: entError } = ids.length
    ? await supabase.from("entitlements").select("id, application_id, name, privilege_level, data_classification").eq("tenant_id", tenantId).in("application_id", ids).order("name").limit(2000)
    : { data: [], error: null };
  if (entError) throw new ApiError(500, "QUERY_FAILED", entError.message);
  const items = (apps ?? []).map((a) => {
    const appPolicy = resolvePolicy(policies, a.id, null);
    const entitlements = (ents ?? [])
      .filter((e) => e.application_id === a.id)
      .map((e) => {
        const policy = resolvePolicy(policies, a.id, e.id);
        const risk = assessRisk({ privilegeLevel: e.privilege_level, dataClassification: e.data_classification, appRiskLevel: a.risk_level });
        return {
          id: e.id as string,
          name: e.name as string,
          privilegeLevel: e.privilege_level as string,
          dataClassification: (e.data_classification as string | null) ?? null,
          risk,
          requestable: Boolean(policy?.requestable),
          approval: approvalOutcome(policy, risk),
          policy,
        };
      });
    const appRisk = assessRisk({ appRiskLevel: a.risk_level, appDataClassification: a.data_classification });
    return {
      applicationId: a.id as string,
      name: (a.display_name as string | null) ?? (a.name as string),
      names: [a.name as string, a.display_name as string | null].filter((n): n is string => Boolean(n)),
      description: (a.description as string | null) ?? null,
      vendor: (a.vendor as string | null) ?? null,
      risk: appRisk,
      requestable: Boolean(appPolicy?.requestable) || entitlements.some((e) => e.requestable),
      appRequestable: Boolean(appPolicy?.requestable),
      approval: approvalOutcome(appPolicy, appRisk),
      policy: appPolicy,
      entitlements,
    };
  });
  return { items, total: count ?? 0 };
}

/** One live application's catalog entry, or null. */
export async function getRequestCatalogItem(tenantId: string, applicationId: string): Promise<CatalogItem | null> {
  if (!UUID_RE.test(applicationId)) return null;
  return (await listRequestCatalog(tenantId, { applicationId, pageSize: 1 })).items[0] ?? null;
}

// ---------------------------------------------------------------- requests

export type RequestInput = { subjectIdentityId?: unknown; applicationId?: unknown; entitlementId?: unknown; durationDays?: unknown; justification?: unknown; requestType?: unknown };
export type RequestActor = { userId: string; canManageAccess: boolean };

/**
 * Submits a request for oneself or someone else. The governing policy is
 * applied deterministically: a refusal says why; a request under an
 * auto-approval policy below its risk threshold is approved at once;
 * otherwise it waits for approval. An identical open request is returned
 * rather than duplicated.
 */
export async function submitAccessRequest(
  tenantId: string,
  actor: RequestActor,
  input: RequestInput,
  /** ACCESS-P0-38: set by the server for a basket's requests, never taken from the client. */
  opts: { basketId?: string } = {},
): Promise<{ request: AccessRequest; duplicate: boolean }> {
  const applicationId = typeof input.applicationId === "string" ? input.applicationId : "";
  const entitlementId = typeof input.entitlementId === "string" && input.entitlementId ? input.entitlementId : null;
  if (!UUID_RE.test(applicationId) || (entitlementId && !UUID_RE.test(entitlementId))) throw new ApiError(400, "VALIDATION_FAILED", "applicationId (and entitlementId, if given): ids");
  // ACCESS-P0-30: access (or, with no entitlement, an account), access to remove, or an account to disable.
  const requestType = input.requestType === undefined || input.requestType === null || input.requestType === "" ? "grant" : input.requestType;
  // ACCESS-P0-32: or to keep access the subject holds for longer.
  if (requestType !== "grant" && requestType !== "remove" && requestType !== "disable_account" && requestType !== "extend") throw new ApiError(400, "VALIDATION_FAILED", "requestType: grant, remove, disable_account or extend");
  if (requestType === "remove" && !entitlementId) throw new ApiError(400, "VALIDATION_FAILED", "entitlementId: the access to remove");
  if (requestType === "extend" && !entitlementId) throw new ApiError(400, "VALIDATION_FAILED", "entitlementId: the access to extend");
  if (requestType === "disable_account" && entitlementId) throw new ApiError(400, "VALIDATION_FAILED", "entitlementId: not used when disabling an account");
  const requester = await getIdentityForUser(tenantId, actor.userId);
  const subjectId = typeof input.subjectIdentityId === "string" && input.subjectIdentityId ? input.subjectIdentityId : requester?.id;
  if (!subjectId || !UUID_RE.test(subjectId)) throw new ApiError(400, "VALIDATION_FAILED", "subjectIdentityId: who the access is for");

  const supabase = await supabaseServer();
  const [subject, appRes, entRes, policies] = await Promise.all([
    getIdentity(tenantId, subjectId),
    supabase.from("applications").select("id, name, display_name, onboarding_status, risk_level, data_classification").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle(),
    entitlementId
      ? supabase.from("entitlements").select("id, application_id, privilege_level, data_classification, requestable, entitlement_type").eq("tenant_id", tenantId).eq("id", entitlementId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    listRequestPolicies(tenantId),
  ]);
  if (appRes.error || entRes.error) throw new ApiError(500, "QUERY_FAILED", (appRes.error ?? entRes.error)!.message);
  if (!subject) throw new ApiError(404, "NOT_FOUND", "subjectIdentityId: that identity is not in this organization");
  if (!appRes.data) throw new ApiError(404, "NOT_FOUND", "applicationId: that application is not in this organization");
  if (entitlementId && (!entRes.data || entRes.data.application_id !== applicationId)) throw new ApiError(404, "NOT_FOUND", "entitlementId: not an entitlement of that application");

  // ACCESS-P0-30: there must be something to remove or to disable (what the target last reported).
  if (requestType !== "grant") await assertSomethingToChange(tenantId, subject.id, applicationId, requestType, entitlementId);

  const now = new Date();
  const policy = resolvePolicy(policies, applicationId, entitlementId);
  // Taking access away lowers risk, so a removal or a disable is low risk whatever it removes; keeping it longer is as risky as granting it.
  const timed = requestType === "grant" || requestType === "extend";
  const risk =
    timed
      ? assessRisk({
          privilegeLevel: entRes.data?.privilege_level,
          dataClassification: entRes.data?.data_classification,
          appRiskLevel: appRes.data.risk_level,
          appDataClassification: appRes.data.data_classification,
        })
      : "low";
  // ACCESS-P0-31: who owns the subject, and for an agent whether this is within its contract.
  const agentId = subject.identityType === "AI_AGENT" ? subject.agentId : null;
  const [owners, contract] = agentId ? await Promise.all([listOwners(tenantId, agentId), getAgentContract(agentId, tenantId)]) : [[], null];
  const requesterOwnsSubject = agentId
    ? owners.some((o) => o.ownerType === "business_owner" && o.userId === actor.userId)
    : requester !== null && subject.ownerIdentityId !== null && subject.ownerIdentityId === requester.id;
  const agentContract = !agentId
    ? undefined
    : !timed
      ? "within" // taking access away is always within the contract
      : !contract
        ? "none"
        : withinContract(contract, [appRes.data.name, appRes.data.display_name], entRes.data?.data_classification ?? null)
          ? "within"
          : "outside";
  let durationRaw = !timed || input.durationDays === undefined || input.durationDays === null || input.durationDays === "" ? null : Number(input.durationDays);
  // ACCESS-P0-33: an entitlement not requestable (itself or by its type) is refused; its type's default and maximum duration apply.
  if (timed && entRes.data) {
    const typeRules = entitlementRequestRules(
      { requestable: entRes.data.requestable !== false },
      await typeForRequest(tenantId, applicationId, (entRes.data.entitlement_type as string | null) ?? null),
      durationRaw !== null && Number.isFinite(durationRaw) ? durationRaw : null,
    );
    if (!typeRules.ok) {
      await writeAudit({ tenantId, actorId: actor.userId, actorType: "user", action: "access.request_refused", objectType: "application", objectId: applicationId, outcome: "failure", metadata: { subjectIdentityId: subject.id, entitlementId, code: typeRules.code } });
      throw new ApiError(typeRules.status, typeRules.code, typeRules.message);
    }
    if (durationRaw === null || Number.isFinite(durationRaw)) durationRaw = typeRules.durationDays;
  }
  const decision = evaluateRequest({
    policy,
    appActive: appRes.data.onboarding_status === "ACTIVE",
    risk,
    requesterIdentityId: requester?.id ?? null,
    subject: { id: subject.id, status: subject.status, managerIdentityId: subject.managerIdentityId, identityType: subject.identityType, ownerIdentityId: subject.ownerIdentityId },
    requesterCanManageAccess: actor.canManageAccess,
    requesterOwnsSubject,
    agentContract,
    durationDays: durationRaw,
    justification: typeof input.justification === "string" ? input.justification : "",
    now,
  });
  if (!decision.ok) {
    await writeAudit({ tenantId, actorId: actor.userId, actorType: "user", action: "access.request_refused", objectType: "application", objectId: applicationId, outcome: "failure", metadata: { subjectIdentityId: subject.id, agentId, entitlementId, code: decision.code } });
    throw new ApiError(decision.status, decision.code, decision.message);
  }
  // ACCESS-P0-14 / P0-31: an agent's separation-of-duties rules apply to its requests, before anything is written.
  if (agentId) await enforceSoD(tenantId, actor.userId, "access.request_submitted", agentId);

  // An identical open request is returned, not duplicated (spec §11.5), once the
  // rules allow this requester to ask (ACCESS-P0-31: never someone else's request to a refused one).
  let dupQuery = supabase
    .from("access_requests")
    .select()
    .eq("tenant_id", tenantId)
    .eq("subject_identity_id", subject.id)
    .eq("application_id", applicationId)
    .eq("request_type", requestType)
    .in("status", ["pending", "approved"]);
  dupQuery = entitlementId ? dupQuery.eq("entitlement_id", entitlementId) : dupQuery.is("entitlement_id", null);
  const { data: open, error: dupError } = await dupQuery.order("created_at", { ascending: false }).limit(5);
  if (dupError) throw new ApiError(500, "QUERY_FAILED", dupError.message);
  const stillOpen = (open ?? []).find((r) => !r.requested_expiry || new Date(r.requested_expiry) > now);
  if (stillOpen) return { request: toAccessRequest(stillOpen), duplicate: true };

  const justification = typeof input.justification === "string" ? input.justification.trim().slice(0, 2000) : "";
  const { data, error } = await supabaseServiceRole()
    .from("access_requests")
    .insert({
      tenant_id: tenantId,
      // ACCESS-P0-31: an agent's request names the agent too, so its grant lands on the agent's account.
      agent_id: agentId,
      subject_identity_id: subject.id,
      requester_identity_id: requester?.id ?? null,
      requested_by: actor.userId,
      application_id: applicationId,
      entitlement_id: entitlementId,
      request_type: requestType,
      justification,
      basket_id: opts.basketId ?? null,
      status: decision.initialStatus,
      request_policy_id: policy!.id,
      policy_result: { checks: decision.checks },
      risk_level: risk,
      // A removal or a disable lasts: it has no duration or expiry.
      duration_days: timed ? decision.durationDays : null,
      requested_expiry: timed ? decision.expiresAt : null,
      ...(decision.initialStatus === "approved" ? { decided_at: now.toISOString() } : {}),
    })
    .select()
    .single();
  if (error?.code === "23505") {
    // Someone submitted the identical request a moment ago: return theirs.
    const { data: again } = await dupQuery.eq("status", "pending").limit(1).maybeSingle();
    if (again) return { request: toAccessRequest(again), duplicate: true };
    // A waiting request of another kind for the same access holds the key until it is decided.
    throw new ApiError(409, "ANOTHER_REQUEST_WAITING", "Another request for this access is waiting for approval; decide or cancel it first");
  }
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Could not submit the request");
  let request = toAccessRequest(data);
  await writeAudit({
    tenantId,
    actorId: actor.userId,
    actorType: "user",
    action: decision.initialStatus === "approved" ? "access.request_auto_approved" : "access.request_submitted",
    objectType: "access_request",
    objectId: request.id,
    outcome: "success",
    metadata: { subjectIdentityId: subject.id, agentId, applicationId, entitlementId, risk, policyId: policy!.id, durationDays: decision.durationDays, checks: decision.checks },
  });
  // ACCESS-P0-28: approved by its policy alone, it becomes its pending grant at once.
  if (request.status === "approved") await pendRequest(tenantId, request.id);
  if (request.status === "pending") {
    // ACCESS-P0-19: route it to its approvers. The request is stored either
    // way; a chain that cannot start now is built on the next waiting view
    // (repairApprovalChains), and the failure is audited, not hidden.
    try {
      await startApprovalChain(tenantId, actor.userId, request);
      const { data: routed } = await supabaseServiceRole().from("access_requests").select().eq("tenant_id", tenantId).eq("id", request.id).maybeSingle();
      if (routed) request = toAccessRequest(routed);
    } catch (err) {
      await writeAudit({ tenantId, actorId: actor.userId, actorType: "user", action: "access.approval_chain_started", objectType: "access_request", objectId: request.id, outcome: "failure", metadata: { error: err instanceof ApiError ? err.code : "UNEXPECTED" } });
    }
  }
  return { request, duplicate: false };
}

/** ACCESS-P0-31: an application (by name or display name) and data classification the agent's contract approves. */
export function withinContract(contract: Parameters<typeof classifyAccessGrant>[0], appNames: (string | null | undefined)[], dataClassification: string | null): boolean {
  return appNames.some((name) => Boolean(name) && classifyAccessGrant(contract, { application: name, dataClassification }) === "approved");
}

/** The requester withdraws a request that is still waiting. */
export async function cancelAccessRequest(tenantId: string, actorUserId: string, requestId: string): Promise<AccessRequest> {
  if (!UUID_RE.test(requestId)) throw new ApiError(404, "NOT_FOUND", "No such request");
  const supabase = await supabaseServer();
  const { data: existing, error: readError } = await supabase.from("access_requests").select().eq("tenant_id", tenantId).eq("id", requestId).maybeSingle();
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  if (!existing) throw new ApiError(404, "NOT_FOUND", "No such request");
  if (existing.requested_by !== actorUserId) throw new ApiError(403, "FORBIDDEN", "Only the requester can cancel a request");
  const now = new Date().toISOString();
  const { data, error } = await supabaseServiceRole()
    .from("access_requests")
    .update({ status: "cancelled", cancelled_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(409, "CONFLICT", "Only a request that is still waiting can be cancelled");
  await writeAudit({ tenantId, actorId: actorUserId, actorType: "user", action: "access.request_cancelled", objectType: "access_request", objectId: requestId, outcome: "success", metadata: { subjectIdentityId: existing.subject_identity_id } });
  return toAccessRequest(data);
}

export type RequestRow = AccessRequest & { subjectName: string | null; applicationName: string | null; entitlementName: string | null; packageName: string | null };

/** Requests, newest first, paged at the database: everyone's, or the actor's own. */
export async function listRequests(
  tenantId: string,
  filter: {
    mineUserId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
    /** ACCESS-P0-19: only these requests (the ones awaiting the caller), plus waiting agent requests when asked. */
    awaiting?: { ids: string[]; pendingAgentRequests: boolean };
  } = {},
): Promise<{ rows: RequestRow[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const supabase = await supabaseServer();
  let query = supabase.from("access_requests").select("*, applications(name, display_name), entitlements(name), access_packages(name)", { count: "exact" }).eq("tenant_id", tenantId);
  if (filter.mineUserId) query = query.eq("requested_by", filter.mineUserId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.awaiting) {
    const ids = filter.awaiting.ids.filter((id) => UUID_RE.test(id));
    const byId = ids.length ? `id.in.(${ids.join(",")})` : null;
    const agents = filter.awaiting.pendingAgentRequests ? "and(agent_id.not.is.null,subject_identity_id.is.null,status.eq.pending)" : null;
    const either = [byId, agents].filter(Boolean).join(",");
    if (!either) return { rows: [], total: 0 };
    query = query.or(either);
  }
  const { data, error, count } = await query.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const names = await getIdentityNames(tenantId, (data ?? []).map((r) => r.subject_identity_id as string).filter(Boolean));
  return {
    rows: (data ?? []).map((r) => ({
      ...toAccessRequest(r),
      subjectName: r.subject_identity_id ? (names.get(r.subject_identity_id)?.displayName ?? null) : null,
      applicationName: (r.applications as { name: string; display_name: string | null } | null)?.display_name ?? (r.applications as { name: string } | null)?.name ?? null,
      entitlementName: (r.entitlements as { name: string } | null)?.name ?? null,
      packageName: (r.access_packages as { name: string } | null)?.name ?? null,
    })),
    total: count ?? 0,
  };
}



/**
 * ACCESS-P0-30: a removal names access the subject holds (live, not still
 * waiting for fulfilment, and not already being removed); a disable needs
 * an active account. Read with the service role, filtered on the tenant.
 */
async function assertSomethingToChange(tenantId: string, subjectId: string, applicationId: string, requestType: "remove" | "disable_account" | "extend", entitlementId: string | null): Promise<void> {
  const admin = supabaseServiceRole();
  const { data: accounts, error } = await admin.from("accounts").select("id, tenant_id, status").eq("tenant_id", tenantId).eq("application_id", applicationId).eq("identity_id", subjectId).neq("status", "pending").limit(10);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const own = (accounts ?? []).filter((a) => a.tenant_id === tenantId);
  if (requestType === "disable_account") {
    if (!own.some((a) => a.status === "active")) throw new ApiError(409, "NOTHING_TO_CHANGE", "There is no active account on this application to disable");
    return;
  }
  let grantQuery = admin
    .from("access_grants")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("account_id", own.map((a) => a.id as string))
    .eq("entitlement_id", entitlementId!)
    .is("revoked_at", null)
    .neq("fulfilment_status", "pending_fulfilment");
  // ACCESS-P0-32: access held through a request (not a package) can be extended, even once its end date has turned it into removal work.
  grantQuery = requestType === "extend" ? grantQuery.is("access_package_assignment_item_id", null).or("removal_status.is.null,removal_status.eq.pending_removal") : grantQuery.is("removal_status", null);
  const { data: grants, error: grantError } = own.length ? await grantQuery.limit(1) : { data: [], error: null };
  if (grantError) throw new ApiError(500, "QUERY_FAILED", grantError.message);
  if (!grants?.length) {
    throw new ApiError(409, "NOTHING_TO_CHANGE", requestType === "extend" ? "There is no access from a request to extend" : "This access is not held (or its removal is already under way)");
  }
}

/** The dashboard's platform summary: access requests still waiting for a decision (a count only, under RLS, filtered on the tenant). */
export async function countPendingAccessRequests(tenantId: string): Promise<number> {
  const supabase = await supabaseServer();
  const { count, error } = await supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pending");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return count ?? 0;
}
