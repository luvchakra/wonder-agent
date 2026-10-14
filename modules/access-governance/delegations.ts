import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { actingFor, isActive, validateDelegation, type DelegationInput } from "./delegationRules";

/**
 * ACCESS-P0-23 — approver delegation. Reads as the caller (RLS: their own,
 * or every one for an access manager); writes with the service role,
 * filtered by the tenant resolved for the request; the engine reads who a
 * member acts for with the service role, by tenant and member.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Delegation = {
  id: string;
  delegatorUserId: string;
  delegateUserId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  revokedAt: string | null;
  active: boolean;
};

function toDelegation(r: Row, now = new Date()): Delegation {
  const d = {
    id: r.id as string,
    delegatorUserId: r.delegator_user_id as string,
    delegateUserId: r.delegate_user_id as string,
    startsAt: r.starts_at as string,
    endsAt: r.ends_at as string,
    reason: (r.reason as string | null) ?? null,
    revokedAt: (r.revoked_at as string | null) ?? null,
  };
  return { ...d, active: isActive(d, now) };
}

/** Delegations the caller gives or receives (an access manager: the organization's), not yet ended. */
export async function listDelegations(tenantId: string): Promise<Delegation[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("access_delegations").select("*").eq("tenant_id", tenantId).is("revoked_at", null).gt("ends_at", new Date().toISOString()).order("starts_at").limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => toDelegation(r));
}

export async function createDelegation(tenantId: string, caller: { userId: string; canManageAccess: boolean }, input: DelegationInput): Promise<Delegation> {
  const v = validateDelegation(input, caller, new Date());
  if ("error" in v) throw new ApiError(v.status ?? 400, v.status === 403 ? "FORBIDDEN" : "VALIDATION_FAILED", v.error);
  const admin = supabaseServiceRole();
  // Both are active members of this organization.
  const { data: members, error: memberError } = await admin.from("tenant_memberships").select("user_id, status").eq("tenant_id", tenantId).in("user_id", [v.delegator_user_id, v.delegate_user_id]);
  if (memberError) throw new ApiError(500, "QUERY_FAILED", memberError.message);
  for (const id of [v.delegator_user_id, v.delegate_user_id]) {
    if (!(members ?? []).some((m) => m.user_id === id && m.status === "active"))
      throw new ApiError(404, "NOT_FOUND", `${id === v.delegate_user_id ? "delegateUserId" : "delegatorUserId"}: not an active member of this organization`);
  }
  const { data, error } = await admin
    .from("access_delegations")
    .insert({ tenant_id: tenantId, ...v, created_by: caller.userId })
    .select("*")
    .single();
  if (error || !data) throw new ApiError(error?.code === "23514" ? 400 : 500, "WRITE_FAILED", error?.message ?? "Could not save");
  await writeAudit({
    tenantId,
    actorId: caller.userId,
    actorType: "user",
    action: "access.delegation_created",
    objectType: "access_delegation",
    objectId: data.id as string,
    outcome: "success",
    metadata: { delegatorUserId: v.delegator_user_id, delegateUserId: v.delegate_user_id, scope: v.scope, startsAt: v.starts_at, endsAt: v.ends_at },
    typedText: { reason: v.reason },
  });
  return toDelegation(data);
}

/** Ends a delegation now: by the person away, the delegate, or an access manager. */
export async function revokeDelegation(tenantId: string, caller: { userId: string; canManageAccess: boolean }, delegationId: string): Promise<Delegation> {
  if (!UUID_RE.test(delegationId)) throw new ApiError(404, "NOT_FOUND", "No such delegation");
  const admin = supabaseServiceRole();
  const { data: row, error } = await admin.from("access_delegations").select("*").eq("tenant_id", tenantId).eq("id", delegationId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!row || row.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such delegation");
  if (!caller.canManageAccess && caller.userId !== row.delegator_user_id && caller.userId !== row.delegate_user_id) throw new ApiError(404, "NOT_FOUND", "No such delegation");
  if (row.revoked_at) return toDelegation(row);
  const { data, error: updateError } = await admin
    .from("access_delegations")
    .update({ revoked_at: new Date().toISOString(), revoked_by: caller.userId })
    .eq("tenant_id", tenantId)
    .eq("id", delegationId)
    .is("revoked_at", null)
    .select("*")
    .maybeSingle();
  if (updateError) throw new ApiError(500, "WRITE_FAILED", updateError.message);
  if (!data) throw new ApiError(409, "CONFLICT", "Ended meanwhile; reload");
  await writeAudit({
    tenantId,
    actorId: caller.userId,
    actorType: "user",
    action: "access.delegation_revoked",
    objectType: "access_delegation",
    objectId: delegationId,
    outcome: "success",
    metadata: { delegatorUserId: row.delegator_user_id, delegateUserId: row.delegate_user_id },
  });
  return toDelegation(data);
}

async function inForce(tenantId: string, column: "delegate_user_id" | "delegator_user_id", userIds: string[]) {
  if (!userIds.length) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabaseServiceRole()
    .from("access_delegations")
    .select("tenant_id, delegator_user_id, delegate_user_id, starts_at, ends_at, revoked_at")
    .eq("tenant_id", tenantId)
    .in(column, userIds)
    .is("revoked_at", null)
    .lte("starts_at", now)
    .gt("ends_at", now);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as Row[])
    .filter((r) => r.tenant_id === tenantId)
    .map((r) => ({ delegatorUserId: r.delegator_user_id as string, delegateUserId: r.delegate_user_id as string, startsAt: r.starts_at as string, endsAt: r.ends_at as string, revokedAt: null }));
}

/** The members whose approvals this member may decide now. */
export async function approvalsActingFor(tenantId: string, userId: string): Promise<string[]> {
  return actingFor(await inForce(tenantId, "delegate_user_id", [userId]), userId, new Date());
}

/** The delegates in force now for these approvers, to tell them too. */
export async function activeDelegatesOf(tenantId: string, approverUserIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const d of await inForce(tenantId, "delegator_user_id", approverUserIds)) out.set(d.delegatorUserId, [...(out.get(d.delegatorUserId) ?? []), d.delegateUserId]);
  return out;
}
