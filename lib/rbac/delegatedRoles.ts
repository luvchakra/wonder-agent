import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { planDelegatedRoles, type HeldRole, type SkippedRole } from "./delegatedRoleRules";

/**
 * ACCESS-P0-23 part 3 — Foundation's side of administration delegation:
 * the delegate's time-bound copies of the delegator's roles, written to
 * user_roles with the service role (the caller has checked role.manage and
 * resolved the tenant), each naming its delegation and audited like any
 * role assignment.
 */

type Row = Record<string, unknown>;

export async function grantDelegatedRoles(
  tenantId: string,
  actorId: string,
  d: { delegationId: string; delegatorUserId: string; delegateUserId: string; startsAt: string; endsAt: string },
): Promise<{ granted: string[]; skipped: SkippedRole[] }> {
  // Nobody grants themselves a role (the database refuses it too).
  if (actorId === d.delegateUserId) throw new ApiError(403, "SELF_ESCALATION", "Someone else sets up an administration delegation to you");
  const admin = supabaseServiceRole();
  const [own, theirs] = await Promise.all([
    admin
      .from("user_roles")
      .select("tenant_id, role_id, scope_type, scope_values, starts_at, expires_at, requires_mfa, delegation_id, roles!inner(name, status)")
      .eq("tenant_id", tenantId)
      .eq("user_id", d.delegatorUserId),
    admin.from("user_roles").select("tenant_id, role_id").eq("tenant_id", tenantId).eq("user_id", d.delegateUserId),
  ]);
  if (own.error || theirs.error) throw new ApiError(500, "QUERY_FAILED", (own.error ?? theirs.error)!.message);
  const held: HeldRole[] = ((own.data ?? []) as Row[])
    .filter((r) => r.tenant_id === tenantId)
    .map((r) => {
      const role = r.roles as unknown as { name: string; status: string };
      return {
        roleId: r.role_id as string,
        roleName: role.name,
        roleActive: role.status === "active",
        scopeType: r.scope_type as string,
        scopeValues: (r.scope_values as string[] | null) ?? [],
        startsAt: (r.starts_at as string | null) ?? null,
        expiresAt: (r.expires_at as string | null) ?? null,
        requiresMfa: r.requires_mfa === true,
        delegationId: (r.delegation_id as string | null) ?? null,
      };
    });
  const plan = planDelegatedRoles(
    held,
    ((theirs.data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => r.role_id as string),
    { startsAt: new Date(d.startsAt).toISOString(), endsAt: new Date(d.endsAt).toISOString() },
  );
  if (!plan.copies.length) return { granted: [], skipped: plan.skipped };
  const { error } = await admin.from("user_roles").insert(
    plan.copies.map((c) => ({
      tenant_id: tenantId,
      user_id: d.delegateUserId,
      role_id: c.roleId,
      granted_by: actorId,
      scope_type: c.scopeType,
      scope_values: c.scopeValues,
      starts_at: c.startsAt,
      expires_at: c.expiresAt,
      requires_mfa: c.requiresMfa,
      delegation_id: d.delegationId,
    })),
  );
  if (error) throw new ApiError(error.code === "23505" ? 409 : 500, error.code === "23505" ? "CONFLICT" : "ASSIGN_FAILED", error.code === "23505" ? "The delegate was given one of these roles meanwhile; try again" : error.message);
  await Promise.all(
    plan.copies.map((c) =>
      writeAudit({
        tenantId,
        actorId,
        actorType: "user",
        action: "role.assigned",
        objectType: "user_role",
        objectId: d.delegateUserId,
        outcome: "success",
        metadata: { role: c.roleName, targetUserId: d.delegateUserId, delegationId: d.delegationId, onBehalfOf: d.delegatorUserId, starts_at: c.startsAt, expires_at: c.expiresAt },
      }),
    ),
  );
  return { granted: plan.copies.map((c) => c.roleName), skipped: plan.skipped };
}

/** Removes a delegation's copies now (it was ended early). Copies an administrator has since changed are no longer the delegation's and stay. */
export async function revokeDelegatedRoles(tenantId: string, actorId: string, delegationId: string): Promise<string[]> {
  const { data, error } = await supabaseServiceRole().from("user_roles").delete().eq("tenant_id", tenantId).eq("delegation_id", delegationId).select("user_id, roles(name)");
  if (error) throw new ApiError(500, "REMOVE_FAILED", error.message);
  const removed = ((data ?? []) as Row[]).map((r) => ({ userId: r.user_id as string, role: (r.roles as unknown as { name: string } | null)?.name ?? "" }));
  await Promise.all(
    removed.map((r) =>
      writeAudit({ tenantId, actorId, actorType: "user", action: "role.removed", objectType: "user_role", objectId: r.userId, outcome: "success", metadata: { role: r.role, targetUserId: r.userId, delegationId } }),
    ),
  );
  return removed.map((r) => r.role);
}
