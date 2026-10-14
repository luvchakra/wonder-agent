import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { groupsOfUser } from "@/lib/users/groups";
import { notify } from "@/modules/operations/service";
import { getIdentity } from "@/modules/agent-identity/service";
import { resolveAssignee, type AssigneeSource, type AssignmentRow } from "./fulfilmentAssignmentRules";
import { typeName } from "./entitlementTypeRules";

/**
 * ACCESS-P0-42 (owner request 2026-10-14) — who does an application's
 * manual fulfilment tasks: a person or a group, for the application and
 * optionally per entitlement type.
 *
 * Reads run as the caller (RLS) with an explicit tenant filter. Writes use
 * the service role, because members cannot write the table directly; every
 * statement filters on the tenant resolved for the request, and the route
 * checks access.manage first. The system path (opening a task) reads with
 * the service role, filtered by the task's tenant.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FulfilmentAssignment = {
  id: string;
  applicationId: string;
  /** Null: the application's default. */
  entitlementType: string | null;
  identityId: string | null;
  identityName: string | null;
  groupId: string | null;
  groupName: string | null;
};

function toAssignment(r: Row): FulfilmentAssignment {
  return {
    id: r.id as string,
    applicationId: r.application_id as string,
    entitlementType: (r.entitlement_type as string | null) ?? null,
    identityId: (r.assignee_identity_id as string | null) ?? null,
    identityName: ((r.identity as Row | null)?.display_name as string | null) ?? null,
    groupId: (r.assignee_group_id as string | null) ?? null,
    groupName: ((r.group as Row | null)?.name as string | null) ?? null,
  };
}

const SELECT = "id, tenant_id, application_id, entitlement_type, assignee_identity_id, assignee_group_id, identity:identities(display_name), group:groups(name)";

export async function listFulfilmentAssignments(tenantId: string, applicationId: string): Promise<FulfilmentAssignment[]> {
  if (!UUID_RE.test(applicationId)) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("application_fulfilment_assignments")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .order("entitlement_type", { nullsFirst: true });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as unknown as Row[]).filter((r) => r.tenant_id === tenantId).map(toAssignment);
}

/** A person who can sign in and work on tasks, or an active group, of this organization. */
export async function assertAssignee(tenantId: string, target: { identityId: string | null; groupId: string | null }): Promise<void> {
  if (target.identityId) {
    const identity = await getIdentity(tenantId, target.identityId);
    if (!identity) throw new ApiError(404, "NOT_FOUND", "identityId: no such person in this organization");
    if (identity.identityType !== "HUMAN" || identity.status !== "active") throw new ApiError(400, "VALIDATION_FAILED", "identityId: must be an active person");
  }
  if (target.groupId) {
    const { data, error } = await supabaseServiceRole().from("groups").select("id, tenant_id, status").eq("tenant_id", tenantId).eq("id", target.groupId).maybeSingle();
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "groupId: no such group in this organization");
    if (data.status !== "active") throw new ApiError(400, "VALIDATION_FAILED", "groupId: the group is inactive");
  }
}

/**
 * Sets who does the application's tasks (no entitlement type) or the tasks
 * for one entitlement type. Replaces what was set for the same scope.
 */
export async function setFulfilmentAssignment(
  tenantId: string,
  actorId: string,
  applicationId: string,
  input: { entitlementType?: unknown; identityId?: unknown; groupId?: unknown },
): Promise<FulfilmentAssignment> {
  if (!UUID_RE.test(applicationId)) throw new ApiError(404, "NOT_FOUND", "No such application");
  const entitlementType = input.entitlementType === undefined || input.entitlementType === null || input.entitlementType === "" ? null : typeName(input.entitlementType);
  if (input.entitlementType && !entitlementType) throw new ApiError(400, "VALIDATION_FAILED", "entitlementType: a type name, or empty for the whole application");
  const identityId = typeof input.identityId === "string" && input.identityId ? input.identityId : null;
  const groupId = typeof input.groupId === "string" && input.groupId ? input.groupId : null;
  if (!identityId === !groupId) throw new ApiError(400, "VALIDATION_FAILED", "Name one person or one group");
  if ((identityId && !UUID_RE.test(identityId)) || (groupId && !UUID_RE.test(groupId))) throw new ApiError(400, "VALIDATION_FAILED", "identityId or groupId: an id");
  const admin = supabaseServiceRole();
  const { data: app, error: appError } = await admin.from("applications").select("id, tenant_id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (appError) throw new ApiError(500, "QUERY_FAILED", appError.message);
  if (!app || app.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such application");
  await assertAssignee(tenantId, { identityId, groupId });

  // One row per scope: replace the existing one, matched ignoring case.
  const { data: existing, error: readError } = await admin.from("application_fulfilment_assignments").select("id, entitlement_type").eq("tenant_id", tenantId).eq("application_id", applicationId);
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  const same = (existing ?? []).find((r) => ((r.entitlement_type as string | null)?.toLowerCase() ?? null) === (entitlementType?.toLowerCase() ?? null));
  const now = new Date().toISOString();
  const write = same
    ? admin
        .from("application_fulfilment_assignments")
        .update({ assignee_identity_id: identityId, assignee_group_id: groupId, updated_by: actorId, updated_at: now })
        .eq("tenant_id", tenantId)
        .eq("id", same.id as string)
    : admin
        .from("application_fulfilment_assignments")
        .insert({
          tenant_id: tenantId,
          application_id: applicationId,
          entitlement_type: entitlementType,
          assignee_identity_id: identityId,
          assignee_group_id: groupId,
          created_by: actorId,
          updated_by: actorId,
        });
  const { data, error } = await write.select(SELECT).single();
  if (error?.code === "23505") throw new ApiError(409, "CONFLICT", "Set meanwhile by someone else; reload");
  if (error || !data) throw new ApiError(500, "WRITE_FAILED", error?.message ?? "Could not save");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.fulfilment_assignment_set",
    objectType: "application",
    objectId: applicationId,
    outcome: "success",
    metadata: { entitlementType, identityId, groupId, replaced: Boolean(same) },
  });
  return toAssignment(data as unknown as Row);
}

export async function removeFulfilmentAssignment(tenantId: string, actorId: string, applicationId: string, assignmentId: string): Promise<void> {
  if (!UUID_RE.test(applicationId) || !UUID_RE.test(assignmentId)) throw new ApiError(404, "NOT_FOUND", "No such assignment");
  const { data, error } = await supabaseServiceRole()
    .from("application_fulfilment_assignments")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .eq("id", assignmentId)
    .select("id, entitlement_type");
  if (error) throw new ApiError(500, "WRITE_FAILED", error.message);
  if (!data?.length) throw new ApiError(404, "NOT_FOUND", "No such assignment");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.fulfilment_assignment_removed",
    objectType: "application",
    objectId: applicationId,
    outcome: "success",
    metadata: { entitlementType: data[0].entitlement_type ?? null },
  });
}

/**
 * Who a new task for this application (and entitlement) goes to. System
 * path: service role, filtered by the tenant the task belongs to.
 */
export async function assigneeForNewTask(
  tenantId: string,
  app: { id: string; technicalOwnerIdentityId: string | null; businessOwnerIdentityId: string | null },
  grantId: string | null,
): Promise<{ identityId: string | null; groupId: string | null; source: AssigneeSource }> {
  const admin = supabaseServiceRole();
  const [rowsRes, grantRes] = await Promise.all([
    admin.from("application_fulfilment_assignments").select("tenant_id, entitlement_type, assignee_identity_id, assignee_group_id").eq("tenant_id", tenantId).eq("application_id", app.id),
    grantId ? admin.from("access_grants").select("tenant_id, entitlements(entitlement_type)").eq("tenant_id", tenantId).eq("id", grantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (rowsRes.error) throw new ApiError(500, "QUERY_FAILED", rowsRes.error.message);
  const rows: AssignmentRow[] = ((rowsRes.data ?? []) as Row[])
    .filter((r) => r.tenant_id === tenantId)
    .map((r) => ({
      entitlementType: (r.entitlement_type as string | null) ?? null,
      identityId: (r.assignee_identity_id as string | null) ?? null,
      groupId: (r.assignee_group_id as string | null) ?? null,
    }));
  const grant = grantRes.data as Row | null;
  const type = grant && grant.tenant_id === tenantId ? (((grant.entitlements as Row | null)?.entitlement_type as string | null) ?? null) : null;
  return resolveAssignee(rows, type, { technicalOwnerIdentityId: app.technicalOwnerIdentityId, businessOwnerIdentityId: app.businessOwnerIdentityId });
}

/** The active groups the member belongs to in this organization. */
export async function activeGroupIdsOf(tenantId: string, userId: string): Promise<string[]> {
  return (await groupsOfUser(tenantId, userId)).filter((g) => g.status === "active").map((g) => g.id);
}

/** Tells the task's new assignee: the person, or every member of the group (system path, tenant-filtered). */
export async function notifyAssignee(tenantId: string, target: { identityId: string | null; groupId: string | null }, message: { title: string; body: string; taskId: string }): Promise<number> {
  const admin = supabaseServiceRole();
  let userIds: string[] = [];
  if (target.identityId) {
    const { data } = await admin.from("identities").select("tenant_id, user_id").eq("tenant_id", tenantId).eq("id", target.identityId).maybeSingle();
    if (data && data.tenant_id === tenantId && data.user_id) userIds = [data.user_id as string];
  } else if (target.groupId) {
    const { data } = await admin.from("group_members").select("tenant_id, user_id").eq("tenant_id", tenantId).eq("group_id", target.groupId).limit(200);
    userIds = ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => r.user_id as string);
  }
  for (const userId of userIds) {
    await notify({ tenantId, userId, type: "fulfilment_task", title: message.title, body: message.body, referenceType: "access_fulfilment_task", referenceId: message.taskId });
  }
  return userIds.length;
}
