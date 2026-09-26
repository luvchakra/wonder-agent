import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AccessRequest } from "@/lib/shared/types/access-governance";
import { getIdentity, getIdentityForUser, getIdentityNames } from "@/modules/agent-identity/service";
import { toAccessRequest } from "./mappers";
import { startApprovalChain } from "./approvals";
import { assessRisk, type RequestPolicy, type RiskLevel } from "./requestRules";
import {
  assignmentExpiry,
  assignmentStatus,
  checkEligibility,
  contentsDigest,
  itemOnEnd,
  packageRisk,
  validatePackageInput,
  type AssignmentStatus,
  type ItemStatus,
} from "./packageRules";

/**
 * ACCESS-P0-20 — access packages (spec §12). Packages and their contents
 * are managed by access managers; people discover and request the packages
 * they are eligible for; a request goes through the approval engine
 * (ACCESS-P0-19) and, once approved, becomes an assignment with one work
 * item per included resource. Fulfilment in the target system belongs to
 * the provisioning pipeline (INTEGRATION-P0-13); until then a person
 * records each item's outcome, and a failure stays visible (partially
 * failed). Expiry and revocation turn fulfilled items into revocation work.
 *
 * Reads run as the user (RLS) with an explicit tenant filter; every write
 * uses the service role, filtered by the tenant resolved from the session,
 * conditional on the state read, and audited.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE: AssignmentStatus[] = ["provisioning", "active", "partially_failed"];

export type AccessPackage = {
  id: string;
  name: string;
  description: string | null;
  ownerIdentityId: string | null;
  ownerName: string | null;
  status: "draft" | "active" | "retired";
  requestable: boolean;
  eligibleIdentityTypes: string[];
  eligibleDepartments: string[];
  approval: RequestPolicy["approval"];
  approvalMode: RequestPolicy["approvalMode"];
  approvalTimeoutDays: number;
  onTimeout: RequestPolicy["onTimeout"];
  maxDurationDays: number | null;
  defaultDurationDays: number | null;
  extensionAllowed: boolean;
  certificationFrequency: string;
  updatedAt: string;
};

export type PackageResource = {
  id: string;
  applicationId: string;
  applicationName: string;
  applicationLive: boolean;
  entitlementId: string | null;
  entitlementName: string | null;
  privilegeLevel: string | null;
  risk: RiskLevel;
};

export type PackageDetail = AccessPackage & { resources: PackageResource[]; risk: RiskLevel };

function toPackage(r: Record<string, unknown>): Omit<AccessPackage, "ownerName"> {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    ownerIdentityId: (r.owner_identity_id as string | null) ?? null,
    status: r.status as AccessPackage["status"],
    requestable: Boolean(r.requestable),
    eligibleIdentityTypes: (r.eligible_identity_types as string[]) ?? [],
    eligibleDepartments: (r.eligible_departments as string[]) ?? [],
    approval: r.approval as AccessPackage["approval"],
    approvalMode: r.approval_mode as AccessPackage["approvalMode"],
    approvalTimeoutDays: r.approval_timeout_days as number,
    onTimeout: r.on_timeout as AccessPackage["onTimeout"],
    maxDurationDays: (r.max_duration_days as number | null) ?? null,
    defaultDurationDays: (r.default_duration_days as number | null) ?? null,
    extensionAllowed: Boolean(r.extension_allowed),
    certificationFrequency: r.certification_frequency as string,
    updatedAt: r.updated_at as string,
  };
}

type ResourceRow = {
  id: string;
  application_id: string;
  entitlement_id: string | null;
  applications: { name: string; display_name: string | null; risk_level: string | null; data_classification: string | null; onboarding_status: string | null } | null;
  entitlements: { name: string; privilege_level: string | null; data_classification: string | null } | null;
};

function toResource(r: ResourceRow): PackageResource {
  const app = r.applications;
  const ent = r.entitlements;
  return {
    id: r.id,
    applicationId: r.application_id,
    applicationName: app ? (app.display_name ?? app.name) : "Application",
    applicationLive: app?.onboarding_status === "ACTIVE",
    entitlementId: r.entitlement_id,
    entitlementName: ent?.name ?? null,
    privilegeLevel: ent?.privilege_level ?? null,
    risk: assessRisk({ privilegeLevel: ent?.privilege_level, dataClassification: ent?.data_classification, appRiskLevel: app?.risk_level, appDataClassification: app?.data_classification }),
  };
}

const RESOURCE_SELECT = "id, application_id, entitlement_id, applications(name, display_name, risk_level, data_classification, onboarding_status), entitlements(name, privilege_level, data_classification)";

async function resourcesOf(tenantId: string, packageIds: string[], client: "user" | "service" = "user"): Promise<Map<string, PackageResource[]>> {
  const out = new Map<string, PackageResource[]>();
  if (!packageIds.length) return out;
  const supabase = client === "user" ? await supabaseServer() : supabaseServiceRole();
  const { data, error } = await supabase.from("access_package_resources").select(`package_id, ${RESOURCE_SELECT}`).eq("tenant_id", tenantId).in("package_id", packageIds).order("created_at").limit(5000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  for (const r of data ?? []) {
    const list = out.get(r.package_id as string) ?? [];
    list.push(toResource(r as unknown as ResourceRow));
    out.set(r.package_id as string, list);
  }
  return out;
}

async function withOwners<T extends Omit<AccessPackage, "ownerName">>(tenantId: string, rows: T[]): Promise<(T & { ownerName: string | null })[]> {
  const names = await getIdentityNames(tenantId, rows.map((p) => p.ownerIdentityId).filter((x): x is string => Boolean(x)));
  return rows.map((p) => ({ ...p, ownerName: p.ownerIdentityId ? (names.get(p.ownerIdentityId)?.displayName ?? null) : null }));
}

export type PackageListItem = AccessPackage & { risk: RiskLevel; resourceCount: number; resources: PackageResource[] };

/**
 * Packages, paged at the database. `discoverFor` (the viewer's identity)
 * narrows to what that identity may discover: active, requestable, of its
 * identity type and — when the package names departments — its department.
 * Without it (access managers), every package, optionally by status.
 */
export async function listPackages(
  tenantId: string,
  filter: { q?: string; status?: string; discoverFor?: { identityType: string; department: string | null } | null; page?: number; pageSize?: number } = {},
): Promise<{ items: PackageListItem[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 20, 1), 50);
  const page = Math.max(filter.page ?? 1, 1);
  const supabase = await supabaseServer();
  let query = supabase.from("access_packages").select("*", { count: "exact" }).eq("tenant_id", tenantId);
  if (filter.discoverFor !== undefined) {
    if (filter.discoverFor === null) return { items: [], total: 0 };
    query = query.eq("status", "active").eq("requestable", true).contains("eligible_identity_types", [filter.discoverFor.identityType]);
    const dept = (filter.discoverFor.department ?? "").trim();
    query = dept ? query.or(`eligible_departments.eq.{},eligible_departments.cs.{"${dept.replace(/["\\{},]/g, "")}"}`) : query.eq("eligible_departments", "{}");
  } else if (filter.status && ["draft", "active", "retired"].includes(filter.status)) {
    query = query.eq("status", filter.status);
  }
  const q = filter.q?.trim().replace(/[%_,()*\\]/g, " ").trim();
  if (q) query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
  const { data, error, count } = await query.order("name").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = await withOwners(tenantId, (data ?? []).map(toPackage));
  const resources = await resourcesOf(tenantId, rows.map((r) => r.id));
  return {
    items: rows.map((p) => {
      const res = resources.get(p.id) ?? [];
      return { ...p, resources: res, resourceCount: res.length, risk: packageRisk(res.map((x) => x.risk)) };
    }),
    total: count ?? 0,
  };
}

export async function getPackage(tenantId: string, packageId: string): Promise<PackageDetail | null> {
  if (!UUID_RE.test(packageId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("access_packages").select().eq("tenant_id", tenantId).eq("id", packageId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;
  const [withOwner] = await withOwners(tenantId, [toPackage(data)]);
  const resources = (await resourcesOf(tenantId, [packageId])).get(packageId) ?? [];
  return { ...withOwner, resources, risk: packageRisk(resources.map((r) => r.risk)) };
}

/**
 * For the approval engine: a package's approval terms, risk, owner and
 * contents digest, read with the service role (the engine also runs from
 * the timeout sweep), filtered by tenant.
 */
export async function loadPackageForApproval(tenantId: string, packageId: string) {
  const admin = supabaseServiceRole();
  const { data, error } = await admin.from("access_packages").select().eq("tenant_id", tenantId).eq("id", packageId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) throw new ApiError(409, "RESOURCE_GONE", "The package of this request no longer exists");
  const pkg = toPackage(data);
  const resources = (await resourcesOf(tenantId, [packageId], "service")).get(packageId) ?? [];
  return {
    terms: { approval: pkg.approval, approvalMode: pkg.approvalMode, approvalTimeoutDays: pkg.approvalTimeoutDays, onTimeout: pkg.onTimeout, updatedAt: pkg.updatedAt },
    risk: packageRisk(resources.map((r) => r.risk)),
    ownerIdentityId: pkg.ownerIdentityId,
    digest: contentsDigest(resources.map((r) => ({ applicationId: r.applicationId, entitlementId: r.entitlementId, privilegeLevel: r.privilegeLevel }))),
  };
}

async function assertOwner(tenantId: string, ownerIdentityId: unknown): Promise<string | null | undefined> {
  if (ownerIdentityId === undefined) return undefined;
  if (ownerIdentityId === null || ownerIdentityId === "") return null;
  if (typeof ownerIdentityId !== "string" || !UUID_RE.test(ownerIdentityId)) throw new ApiError(400, "VALIDATION_FAILED", "ownerIdentityId: an identity id");
  const owner = await getIdentity(tenantId, ownerIdentityId);
  if (!owner) throw new ApiError(404, "NOT_FOUND", "ownerIdentityId: that identity is not in this organization");
  if (owner.identityType !== "HUMAN" || owner.status !== "active") throw new ApiError(400, "VALIDATION_FAILED", "ownerIdentityId: an active person");
  return owner.id;
}

export async function createPackage(tenantId: string, actorId: string, input: Record<string, unknown>): Promise<AccessPackage> {
  const fields = validatePackageInput(input, false);
  const owner = await assertOwner(tenantId, input.ownerIdentityId);
  const { data, error } = await supabaseServiceRole()
    .from("access_packages")
    .insert({ tenant_id: tenantId, ...fields, ...(owner !== undefined ? { owner_identity_id: owner } : {}), created_by: actorId })
    .select()
    .single();
  if (error?.code === "23505") throw new ApiError(409, "DUPLICATE", "A package with this name already exists");
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Could not create the package");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.package_created", objectType: "access_package", objectId: data.id, outcome: "success", metadata: { name: data.name } });
  const [p] = await withOwners(tenantId, [toPackage(data)]);
  return p;
}

export async function updatePackage(tenantId: string, actorId: string, packageId: string, input: Record<string, unknown>): Promise<AccessPackage> {
  if (!UUID_RE.test(packageId)) throw new ApiError(404, "NOT_FOUND", "No such package");
  const fields = validatePackageInput(input, true);
  const owner = await assertOwner(tenantId, input.ownerIdentityId);
  if (owner !== undefined) fields.owner_identity_id = owner;
  if (input.status !== undefined) {
    if (!["draft", "active", "retired"].includes(input.status as string)) throw new ApiError(400, "VALIDATION_FAILED", "status: draft, active or retired");
    if (input.status === "active") {
      // A package goes live with something in it and someone who owns it.
      const current = await getPackage(tenantId, packageId);
      if (!current) throw new ApiError(404, "NOT_FOUND", "No such package");
      if (!current.resources.length) throw new ApiError(409, "PACKAGE_EMPTY", "Add at least one application or entitlement before activating");
      if (!(owner ?? current.ownerIdentityId)) throw new ApiError(409, "PACKAGE_UNOWNED", "Name an owner before activating");
      if (current.resources.some((r) => !r.applicationLive)) throw new ApiError(409, "APPLICATION_NOT_LIVE", "Every included application must be live");
    }
    fields.status = input.status;
  }
  const { data, error } = await supabaseServiceRole()
    .from("access_packages")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", packageId)
    .select()
    .maybeSingle();
  if (error?.code === "23505") throw new ApiError(409, "DUPLICATE", "A package with this name already exists");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "No such package");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.package_updated", objectType: "access_package", objectId: packageId, outcome: "success", metadata: { fields: Object.keys(fields) } });
  const [p] = await withOwners(tenantId, [toPackage(data)]);
  return p;
}

/** Adds an application's access, or one of its entitlements, to a package. Only live applications. */
export async function addPackageResource(tenantId: string, actorId: string, packageId: string, input: { applicationId?: unknown; entitlementId?: unknown }): Promise<PackageResource> {
  const applicationId = typeof input.applicationId === "string" ? input.applicationId : "";
  const entitlementId = typeof input.entitlementId === "string" && input.entitlementId ? input.entitlementId : null;
  if (!UUID_RE.test(packageId) || !UUID_RE.test(applicationId) || (entitlementId && !UUID_RE.test(entitlementId))) throw new ApiError(400, "VALIDATION_FAILED", "applicationId (and entitlementId, if given): ids");
  const supabase = await supabaseServer();
  const [pkg, app, ent] = await Promise.all([
    supabase.from("access_packages").select("id, status").eq("tenant_id", tenantId).eq("id", packageId).maybeSingle(),
    supabase.from("applications").select("id, onboarding_status").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle(),
    entitlementId ? supabase.from("entitlements").select("id, application_id").eq("tenant_id", tenantId).eq("id", entitlementId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (pkg.error || app.error || ent.error) throw new ApiError(500, "QUERY_FAILED", (pkg.error ?? app.error ?? ent.error)!.message);
  if (!pkg.data) throw new ApiError(404, "NOT_FOUND", "No such package");
  if (pkg.data.status === "retired") throw new ApiError(409, "PACKAGE_RETIRED", "A retired package cannot change");
  if (!app.data) throw new ApiError(404, "NOT_FOUND", "applicationId: that application is not in this organization");
  if (app.data.onboarding_status !== "ACTIVE") throw new ApiError(409, "APPLICATION_NOT_LIVE", "Only a live application can be part of a package");
  if (entitlementId && (!ent.data || ent.data.application_id !== applicationId)) throw new ApiError(404, "NOT_FOUND", "entitlementId: not an entitlement of that application");
  const admin = supabaseServiceRole();
  const { data, error } = await admin
    .from("access_package_resources")
    .insert({ tenant_id: tenantId, package_id: packageId, application_id: applicationId, entitlement_id: entitlementId })
    .select(RESOURCE_SELECT)
    .single();
  if (error?.code === "23505") throw new ApiError(409, "DUPLICATE", "The package already includes this");
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Could not add it");
  await admin.from("access_packages").update({ updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", packageId);
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.package_resource_added", objectType: "access_package", objectId: packageId, outcome: "success", metadata: { applicationId, entitlementId } });
  return toResource(data as unknown as ResourceRow);
}

export async function removePackageResource(tenantId: string, actorId: string, packageId: string, resourceId: string): Promise<void> {
  if (!UUID_RE.test(packageId) || !UUID_RE.test(resourceId)) throw new ApiError(404, "NOT_FOUND", "No such resource");
  const admin = supabaseServiceRole();
  const { data, error } = await admin.from("access_package_resources").delete().eq("tenant_id", tenantId).eq("package_id", packageId).eq("id", resourceId).select("application_id, entitlement_id").maybeSingle();
  if (error) throw new ApiError(500, "DELETE_FAILED", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "No such resource in this package");
  await admin.from("access_packages").update({ updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", packageId);
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.package_resource_removed", objectType: "access_package", objectId: packageId, outcome: "success", metadata: { applicationId: data.application_id, entitlementId: data.entitlement_id } });
}

// ------------------------------------------------------------ requests

export type PackageRequestActor = { userId: string; canManageAccess: boolean };

/**
 * Requests a package for oneself or another identity. The package must be
 * active and requestable, the subject eligible and active; someone else
 * may be requested for by their manager, the owner of a non-human
 * identity, or an access manager. An identical waiting request is
 * returned; a package the subject already holds is refused. The request
 * then waits for its approval chain.
 */
export async function requestPackage(
  tenantId: string,
  actor: PackageRequestActor,
  input: { packageId?: unknown; subjectIdentityId?: unknown; durationDays?: unknown; justification?: unknown },
): Promise<{ request: AccessRequest; duplicate: boolean }> {
  const packageId = typeof input.packageId === "string" ? input.packageId : "";
  if (!UUID_RE.test(packageId)) throw new ApiError(400, "VALIDATION_FAILED", "packageId: an id");
  const requester = await getIdentityForUser(tenantId, actor.userId);
  const subjectId = typeof input.subjectIdentityId === "string" && input.subjectIdentityId ? input.subjectIdentityId : requester?.id;
  if (!subjectId || !UUID_RE.test(subjectId)) throw new ApiError(400, "VALIDATION_FAILED", "subjectIdentityId: who the package is for");
  const [pkg, subject] = await Promise.all([getPackage(tenantId, packageId), getIdentity(tenantId, subjectId)]);
  if (!pkg) throw new ApiError(404, "NOT_FOUND", "No such package");
  if (!subject) throw new ApiError(404, "NOT_FOUND", "subjectIdentityId: that identity is not in this organization");

  const refuse = async (status: number, code: string, message: string): Promise<never> => {
    await writeAudit({ tenantId, actorId: actor.userId, actorType: "user", action: "access.package_request_refused", objectType: "access_package", objectId: packageId, outcome: "failure", metadata: { subjectIdentityId: subject.id, code } });
    throw new ApiError(status, code, message);
  };
  if (pkg.status !== "active" || !pkg.requestable) await refuse(409, "NOT_REQUESTABLE", "This package cannot be requested");
  const eligibility = checkEligibility(pkg, { identityType: subject.identityType, department: subject.department, status: subject.status });
  if (!eligibility.eligible) await refuse(403, "NOT_ELIGIBLE", eligibility.reasons.join("; "));
  const forSelf = requester?.id === subject.id;
  if (!forSelf) {
    const responsible = requester !== null && (subject.managerIdentityId === requester.id || (subject.identityType !== "HUMAN" && subject.ownerIdentityId === requester.id));
    if (!responsible && !actor.canManageAccess) await refuse(403, "REQUEST_SCOPE", "Only the identity's manager or owner, or an access manager, may request this for them");
  }
  const justification = typeof input.justification === "string" ? input.justification.trim().slice(0, 2000) : "";
  if (justification.length < 10) await refuse(400, "JUSTIFICATION_REQUIRED", "Say why it is needed (at least 10 characters)");
  const requestedDays = input.durationDays === undefined || input.durationDays === null || input.durationDays === "" ? null : Number(input.durationDays);
  if (requestedDays !== null && (!Number.isInteger(requestedDays) || requestedDays < 1)) await refuse(400, "VALIDATION_FAILED", "durationDays: a whole number of days");
  const now = new Date();
  let expiry: { days: number | null; expiresAt: string | null };
  try {
    expiry = assignmentExpiry(now, requestedDays, pkg);
  } catch (err) {
    return refuse(400, (err as ApiError).code, (err as ApiError).message);
  }

  const admin = supabaseServiceRole();
  const [{ data: open, error: openError }, { data: held, error: heldError }] = await Promise.all([
    admin.from("access_requests").select().eq("tenant_id", tenantId).eq("subject_identity_id", subject.id).eq("access_package_id", packageId).eq("status", "pending").limit(1).maybeSingle(),
    admin.from("access_package_assignments").select("id").eq("tenant_id", tenantId).eq("identity_id", subject.id).eq("package_id", packageId).in("status", LIVE).limit(1).maybeSingle(),
  ]);
  if (openError || heldError) throw new ApiError(500, "QUERY_FAILED", (openError ?? heldError)!.message);
  if (open) return { request: toAccessRequest(open), duplicate: true };
  if (held) await refuse(409, "ALREADY_ASSIGNED", "The identity already holds this package");

  const checks = [
    { check: "package", result: pkg.name },
    { check: "for", result: forSelf ? "self" : "someone else" },
    { check: "eligibility", result: "eligible" },
    { check: "duration", result: expiry.days ? `${expiry.days} days` : "until removed" },
    { check: "risk", result: pkg.risk },
    { check: "approval", result: pkg.approval },
  ];
  const { data, error } = await admin
    .from("access_requests")
    .insert({
      tenant_id: tenantId,
      agent_id: null,
      application_id: null,
      entitlement_id: null,
      access_package_id: packageId,
      subject_identity_id: subject.id,
      requester_identity_id: requester?.id ?? null,
      requested_by: actor.userId,
      request_type: "grant",
      justification,
      status: "pending",
      policy_result: { checks },
      risk_level: pkg.risk,
      duration_days: expiry.days,
      requested_expiry: expiry.expiresAt,
    })
    .select()
    .single();
  if (error?.code === "23505") {
    const { data: again } = await admin.from("access_requests").select().eq("tenant_id", tenantId).eq("subject_identity_id", subject.id).eq("access_package_id", packageId).eq("status", "pending").limit(1).maybeSingle();
    if (again) return { request: toAccessRequest(again), duplicate: true };
  }
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Could not submit the request");
  let request = toAccessRequest(data);
  await writeAudit({
    tenantId,
    actorId: actor.userId,
    actorType: "user",
    action: "access.package_requested",
    objectType: "access_request",
    objectId: request.id,
    outcome: "success",
    metadata: { packageId, subjectIdentityId: subject.id, risk: pkg.risk, durationDays: expiry.days, checks },
  });
  try {
    await startApprovalChain(tenantId, actor.userId, request);
    const { data: routed } = await admin.from("access_requests").select().eq("tenant_id", tenantId).eq("id", request.id).maybeSingle();
    if (routed) request = toAccessRequest(routed);
  } catch (err) {
    await writeAudit({ tenantId, actorId: actor.userId, actorType: "user", action: "access.approval_chain_started", objectType: "access_request", objectId: request.id, outcome: "failure", metadata: { error: err instanceof ApiError ? err.code : "UNEXPECTED" } });
  }
  return { request, duplicate: false };
}

// ------------------------------------------------------------ assignments

export type AssignmentItem = { id: string; applicationId: string; applicationName: string; entitlementId: string | null; entitlementName: string | null; status: ItemStatus; detail: string | null; updatedAt: string };
export type PackageAssignment = {
  id: string;
  packageId: string;
  packageName: string | null;
  identityId: string;
  identityName: string | null;
  requestId: string | null;
  source: "request" | "direct";
  status: AssignmentStatus;
  justification: string | null;
  startsAt: string;
  expiresAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  items: AssignmentItem[];
};

/** Creates the assignment and its work items, once. A second call for the same request returns the first. */
async function createAssignment(
  tenantId: string,
  actorId: string | null,
  input: { packageId: string; identityId: string; requestId: string | null; justification: string | null; expiresAt: string | null },
): Promise<string> {
  const admin = supabaseServiceRole();
  const resources = (await resourcesOf(tenantId, [input.packageId], "service")).get(input.packageId) ?? [];
  if (!resources.length) throw new ApiError(409, "PACKAGE_EMPTY", "The package includes nothing to assign");
  const { data, error } = await admin
    .from("access_package_assignments")
    .insert({
      tenant_id: tenantId,
      package_id: input.packageId,
      identity_id: input.identityId,
      request_id: input.requestId,
      source: input.requestId ? "request" : "direct",
      status: "provisioning",
      justification: input.justification,
      expires_at: input.expiresAt,
      assigned_by: actorId,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    // Assigned already: by this request a moment ago, or the identity holds it.
    let existing = admin.from("access_package_assignments").select("id").eq("tenant_id", tenantId);
    existing = input.requestId ? existing.eq("request_id", input.requestId) : existing.eq("package_id", input.packageId).eq("identity_id", input.identityId).in("status", LIVE);
    const { data: found } = await existing.limit(1).maybeSingle();
    if (found && input.requestId) return found.id as string;
    throw new ApiError(409, "ALREADY_ASSIGNED", "The identity already holds this package");
  }
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Could not assign the package");
  const { error: itemError } = await admin
    .from("access_package_assignment_items")
    .insert(resources.map((r) => ({ tenant_id: tenantId, assignment_id: data.id, application_id: r.applicationId, entitlement_id: r.entitlementId, status: "pending" })));
  if (itemError) throw new ApiError(500, "CREATE_FAILED", itemError.message);
  return data.id as string;
}

/** Called by the approval engine when a package request is approved: the assignment follows. */
export async function assignApprovedPackageRequest(tenantId: string, actorId: string, requestId: string): Promise<string | null> {
  const admin = supabaseServiceRole();
  const { data: req, error } = await admin.from("access_requests").select().eq("tenant_id", tenantId).eq("id", requestId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!req || req.status !== "approved" || !req.access_package_id || !req.subject_identity_id) return null;
  const assignmentId = await createAssignment(tenantId, actorId, {
    packageId: req.access_package_id as string,
    identityId: req.subject_identity_id as string,
    requestId,
    justification: (req.justification as string | null) ?? null,
    expiresAt: (req.requested_expiry as string | null) ?? null,
  });
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.package_assigned", objectType: "access_package", objectId: req.access_package_id as string, outcome: "success", metadata: { assignmentId, requestId, identityId: req.subject_identity_id, source: "request", expiresAt: req.requested_expiry ?? null } });
  return assignmentId;
}

/**
 * An access manager assigns a package directly — for example to an AI
 * agent, or where no request is needed — with a justification. The
 * identity must be eligible and must not hold it already.
 */
export async function assignPackageDirect(
  tenantId: string,
  actorId: string,
  input: { packageId?: unknown; identityId?: unknown; durationDays?: unknown; justification?: unknown },
): Promise<PackageAssignment> {
  const packageId = typeof input.packageId === "string" ? input.packageId : "";
  const identityId = typeof input.identityId === "string" ? input.identityId : "";
  if (!UUID_RE.test(packageId) || !UUID_RE.test(identityId)) throw new ApiError(400, "VALIDATION_FAILED", "packageId and identityId: ids");
  const [pkg, subject] = await Promise.all([getPackage(tenantId, packageId), getIdentity(tenantId, identityId)]);
  if (!pkg) throw new ApiError(404, "NOT_FOUND", "No such package");
  if (!subject) throw new ApiError(404, "NOT_FOUND", "identityId: that identity is not in this organization");
  if (pkg.status !== "active") throw new ApiError(409, "PACKAGE_NOT_ACTIVE", "Only an active package can be assigned");
  const eligibility = checkEligibility(pkg, { identityType: subject.identityType, department: subject.department, status: subject.status });
  if (!eligibility.eligible) throw new ApiError(403, "NOT_ELIGIBLE", eligibility.reasons.join("; "));
  const justification = typeof input.justification === "string" ? input.justification.trim().slice(0, 2000) : "";
  if (justification.length < 10) throw new ApiError(400, "JUSTIFICATION_REQUIRED", "Say why it is assigned (at least 10 characters)");
  const requestedDays = input.durationDays === undefined || input.durationDays === null || input.durationDays === "" ? null : Number(input.durationDays);
  if (requestedDays !== null && (!Number.isInteger(requestedDays) || requestedDays < 1)) throw new ApiError(400, "VALIDATION_FAILED", "durationDays: a whole number of days");
  const expiry = assignmentExpiry(new Date(), requestedDays, pkg);
  const id = await createAssignment(tenantId, actorId, { packageId, identityId, requestId: null, justification, expiresAt: expiry.expiresAt });
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.package_assigned", objectType: "access_package", objectId: packageId, outcome: "success", metadata: { assignmentId: id, identityId, source: "direct", expiresAt: expiry.expiresAt, justification } });
  return (await getAssignment(tenantId, id))!;
}

type AssignmentRow = Record<string, unknown> & { access_packages: { name: string } | null; access_package_assignment_items: Record<string, unknown>[] };

async function toAssignments(tenantId: string, rows: AssignmentRow[]): Promise<PackageAssignment[]> {
  const names = await getIdentityNames(tenantId, rows.map((r) => r.identity_id as string));
  return rows.map((r) => ({
    id: r.id as string,
    packageId: r.package_id as string,
    packageName: r.access_packages?.name ?? null,
    identityId: r.identity_id as string,
    identityName: names.get(r.identity_id as string)?.displayName ?? null,
    requestId: (r.request_id as string | null) ?? null,
    source: r.source as PackageAssignment["source"],
    status: r.status as AssignmentStatus,
    justification: (r.justification as string | null) ?? null,
    startsAt: r.starts_at as string,
    expiresAt: (r.expires_at as string | null) ?? null,
    endedAt: (r.ended_at as string | null) ?? null,
    endReason: (r.end_reason as string | null) ?? null,
    items: (r.access_package_assignment_items ?? [])
      .map((i) => {
        const app = i.applications as { name: string; display_name: string | null } | null;
        return {
          id: i.id as string,
          applicationId: i.application_id as string,
          applicationName: app ? (app.display_name ?? app.name) : "Application",
          entitlementId: (i.entitlement_id as string | null) ?? null,
          entitlementName: (i.entitlements as { name: string } | null)?.name ?? null,
          status: i.status as ItemStatus,
          detail: (i.detail as string | null) ?? null,
          updatedAt: i.updated_at as string,
        };
      })
      .sort((a, b) => a.applicationName.localeCompare(b.applicationName) || (a.entitlementName ?? "").localeCompare(b.entitlementName ?? "")),
  }));
}

const ASSIGNMENT_SELECT = "*, access_packages(name), access_package_assignment_items(id, application_id, entitlement_id, status, detail, updated_at, applications(name, display_name), entitlements(name))";

export async function listAssignments(
  tenantId: string,
  filter: { packageId?: string; identityId?: string; live?: boolean; page?: number; pageSize?: number } = {},
): Promise<{ rows: PackageAssignment[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  const supabase = await supabaseServer();
  let query = supabase.from("access_package_assignments").select(ASSIGNMENT_SELECT, { count: "exact" }).eq("tenant_id", tenantId);
  if (filter.packageId) query = query.eq("package_id", UUID_RE.test(filter.packageId) ? filter.packageId : "00000000-0000-0000-0000-000000000000");
  if (filter.identityId) query = query.eq("identity_id", UUID_RE.test(filter.identityId) ? filter.identityId : "00000000-0000-0000-0000-000000000000");
  if (filter.live) query = query.in("status", LIVE);
  const { data, error, count } = await query.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return { rows: await toAssignments(tenantId, (data ?? []) as AssignmentRow[]), total: count ?? 0 };
}

export async function getAssignment(tenantId: string, assignmentId: string): Promise<PackageAssignment | null> {
  if (!UUID_RE.test(assignmentId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("access_package_assignments").select(ASSIGNMENT_SELECT).eq("tenant_id", tenantId).eq("id", assignmentId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? (await toAssignments(tenantId, [data as AssignmentRow]))[0] : null;
}

/** Recomputes a live assignment's state from its items (conditional on the state read). */
async function refreshAssignment(tenantId: string, assignmentId: string): Promise<void> {
  const admin = supabaseServiceRole();
  const { data, error } = await admin.from("access_package_assignments").select("status, access_package_assignment_items(status)").eq("tenant_id", tenantId).eq("id", assignmentId).maybeSingle();
  if (error || !data) return;
  const next = assignmentStatus(data.status as AssignmentStatus, ((data.access_package_assignment_items ?? []) as { status: ItemStatus }[]).map((i) => i.status));
  if (next !== data.status) {
    await admin.from("access_package_assignments").update({ status: next, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", assignmentId).eq("status", data.status);
  }
}

const ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  pending: ["fulfilled", "failed"],
  failed: ["fulfilled", "pending"],
  fulfilled: [],
  revoke_pending: ["revoked"],
  revoked: [],
};

/**
 * Records a work item's outcome in the target system (fulfilled or failed
 * on the way in; revoked on the way out) — the step the provisioning
 * pipeline will take over. A failure stays visible on the assignment.
 */
export async function setAssignmentItemStatus(tenantId: string, actorId: string, itemId: string, status: unknown, detail?: unknown): Promise<PackageAssignment> {
  if (!UUID_RE.test(itemId)) throw new ApiError(404, "NOT_FOUND", "No such item");
  if (!["fulfilled", "failed", "pending", "revoked"].includes(status as string)) throw new ApiError(400, "VALIDATION_FAILED", "status: fulfilled, failed, pending or revoked");
  const note = typeof detail === "string" && detail.trim() ? detail.trim().slice(0, 1000) : null;
  if (status === "failed" && !note) throw new ApiError(400, "VALIDATION_FAILED", "detail: say what failed");
  const admin = supabaseServiceRole();
  const { data: item, error } = await admin.from("access_package_assignment_items").select("id, status, assignment_id, access_package_assignments(status)").eq("tenant_id", tenantId).eq("id", itemId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!item) throw new ApiError(404, "NOT_FOUND", "No such item");
  const from = item.status as ItemStatus;
  const assignmentState = (item.access_package_assignments as unknown as { status: AssignmentStatus } | null)?.status;
  if (!ITEM_TRANSITIONS[from].includes(status as ItemStatus)) throw new ApiError(409, "INVALID_TRANSITION", `An item that is ${from.replace("_", " ")} cannot become ${status}`);
  if (status !== "revoked" && assignmentState && !LIVE.includes(assignmentState)) throw new ApiError(409, "ASSIGNMENT_ENDED", "This assignment has ended; only revocation work remains");
  const { data: updated, error: updateError } = await admin
    .from("access_package_assignment_items")
    .update({ status, detail: note, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", itemId)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  if (!updated) throw new ApiError(409, "CONFLICT", "The item changed meanwhile; reload");
  await refreshAssignment(tenantId, item.assignment_id as string);
  await writeAudit({ tenantId, actorId, actorType: "user", action: `access.package_item_${status}`, objectType: "access_package_assignment", objectId: item.assignment_id as string, outcome: "success", metadata: { itemId, from, detail: note } });
  return (await getAssignment(tenantId, item.assignment_id as string))!;
}

async function endAssignment(tenantId: string, actorId: string | null, assignmentId: string, status: "expired" | "revoked", reason: string): Promise<boolean> {
  const admin = supabaseServiceRole();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("access_package_assignments")
    .update({ status, ended_at: now, ended_by: actorId, end_reason: reason, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", assignmentId)
    .in("status", LIVE)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) return false;
  const { data: items, error: itemsError } = await admin.from("access_package_assignment_items").select("id, status").eq("tenant_id", tenantId).eq("assignment_id", assignmentId);
  if (itemsError) throw new ApiError(500, "QUERY_FAILED", itemsError.message);
  for (const target of ["revoke_pending", "revoked"] as const) {
    const ids = (items ?? []).filter((i) => itemOnEnd(i.status as ItemStatus) === target && i.status !== target).map((i) => i.id as string);
    if (ids.length) await admin.from("access_package_assignment_items").update({ status: target, updated_by: actorId, updated_at: now }).eq("tenant_id", tenantId).in("id", ids);
  }
  return true;
}

/** Revokes an assignment: fulfilled access becomes revocation work. */
export async function revokeAssignment(tenantId: string, actorId: string, assignmentId: string, reason: unknown): Promise<PackageAssignment> {
  if (!UUID_RE.test(assignmentId)) throw new ApiError(404, "NOT_FOUND", "No such assignment");
  const why = typeof reason === "string" ? reason.trim().slice(0, 2000) : "";
  if (why.length < 5) throw new ApiError(400, "VALIDATION_FAILED", "reason: say why it is revoked");
  const current = await getAssignment(tenantId, assignmentId);
  if (!current) throw new ApiError(404, "NOT_FOUND", "No such assignment");
  if (!(await endAssignment(tenantId, actorId, assignmentId, "revoked", why))) throw new ApiError(409, "ASSIGNMENT_ENDED", "This assignment has already ended");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.package_revoked", objectType: "access_package_assignment", objectId: assignmentId, outcome: "success", metadata: { packageId: current.packageId, identityId: current.identityId, reason: why } });
  return (await getAssignment(tenantId, assignmentId))!;
}

/**
 * Assignments past their end: expired, and their fulfilled access turned
 * into revocation work (spec §12.3). For one tenant (signed-in package
 * views) or all (the cron job); every write is filtered by the row's own
 * tenant.
 */
export async function sweepPackageExpiry(tenantId: string | null, now = new Date()): Promise<{ expired: number }> {
  const admin = supabaseServiceRole();
  let query = admin.from("access_package_assignments").select("id, tenant_id, package_id, identity_id").in("status", LIVE).lt("expires_at", now.toISOString()).order("expires_at").limit(200);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  let expired = 0;
  for (const a of data ?? []) {
    if (await endAssignment(a.tenant_id as string, null, a.id as string, "expired", "The assignment reached its end date")) {
      expired += 1;
      await writeAudit({ tenantId: a.tenant_id as string, actorId: null, actorType: "system", action: "access.package_expired", objectType: "access_package_assignment", objectId: a.id as string, outcome: "success", metadata: { packageId: a.package_id, identityId: a.identity_id } });
    }
  }
  return { expired };
}

/** Live applications, for choosing what a package includes. */
export async function listLiveApplications(tenantId: string): Promise<{ id: string; name: string }[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("applications").select("id, name, display_name").eq("tenant_id", tenantId).eq("onboarding_status", "ACTIVE").order("name").limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((a) => ({ id: a.id as string, name: (a.display_name as string | null) ?? (a.name as string) }));
}
