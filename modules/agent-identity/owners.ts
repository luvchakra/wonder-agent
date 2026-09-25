import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { notify } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AgentOwner, AgentOwnerType, OwnershipIssue } from "@/lib/shared/types/agent-identity";
import { toAgentOwner } from "./mappers";

const REQUIRED_OWNER_TYPES: AgentOwnerType[] = ["business_owner", "technical_owner"];
const RECOMMENDED_HIGH_RISK_OWNER_TYPES: AgentOwnerType[] = ["iam_owner", "application_owner"];

/**
 * IDENTITY-P0-02.2. `agent_owners` has a client-facing tenant-scoped
 * INSERT/SELECT/UPDATE policy (migration 0014), so this runs as the calling
 * user via supabaseServer() — no manual tenant check needed beyond what RLS
 * already enforces.
 */
export async function assignOwner(
  tenantId: string,
  agentId: string,
  ownerType: AgentOwnerType,
  userId: string,
  actorId: string,
  delegation?: { expiresAt: string },
): Promise<AgentOwner> {
  // IDENTITY-P0-13: a delegated owner acts for someone else for a bounded
  // time. The person delegating is the actor, and the expiry is required
  // (the database enforces both too).
  let delegationFields: Record<string, unknown> = {};
  if (ownerType === "delegated_owner") {
    const expires = delegation?.expiresAt ? new Date(delegation.expiresAt) : null;
    const now = Date.now();
    if (!expires || Number.isNaN(expires.getTime()) || expires.getTime() <= now) {
      throw new ApiError(400, "VALIDATION_FAILED", "A delegated owner needs a delegation expiry in the future");
    }
    if (expires.getTime() > now + 366 * 24 * 60 * 60 * 1000) {
      throw new ApiError(400, "VALIDATION_FAILED", "A delegation can last at most a year");
    }
    delegationFields = { delegated_by: actorId, delegation_expires_at: expires.toISOString() };
  }
  const supabase = await supabaseServer();
  // IDENTITY-P0-13: an owner must be an active member of this
  // organization; any other user id is refused (#4). The agent's own
  // tenant is enforced by the (agent_id, tenant_id) foreign key (0075).
  const { data: membership, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle<{ status: string }>();
  if (membershipError) throw new ApiError(500, "QUERY_FAILED", membershipError.message);
  if (membership?.status !== "active") {
    throw new ApiError(400, "VALIDATION_FAILED", "An owner must be an active member of this organization");
  }
  const { data, error } = await supabase
    .from("agent_owners")
    .insert({ tenant_id: tenantId, agent_id: agentId, owner_type: ownerType, user_id: userId, ...delegationFields })
    .select()
    .single();
  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to assign owner");
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent.owner_changed",
    objectType: "agent",
    objectId: agentId,
    outcome: "success",
    metadata: { ownerType, userId, change: "assigned", delegationExpiresAt: delegationFields.delegation_expires_at ?? null },
  });

  return toAgentOwner(data);
}

export async function removeOwner(
  tenantId: string,
  agentId: string,
  ownerRowId: string,
  actorId: string,
): Promise<void> {
  const supabase = await supabaseServer();

  // OPERATIONS-P0-02.2 (2026-09-19) — snapshot required-type coverage
  // before the removal so the notify() below fires only when THIS
  // removal is what creates the gap, not because one happened to already
  // exist for an unrelated reason.
  const before = await listOwners(tenantId, agentId);
  const removedRow = before.find((o) => o.id === ownerRowId);

  const { error } = await supabase
    .from("agent_owners")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", ownerRowId)
    .eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent.owner_changed",
    objectType: "agent",
    objectId: agentId,
    outcome: "success",
    metadata: { ownerRowId, change: "removed" },
  });

  // `ownership_missing`'s notify() trigger: getOwnershipIssues() derives
  // the gap on read, with no write of its own to hook — this removal,
  // when it's the one that takes a required owner type to zero, is the
  // one genuine write event. No specific person to target (there's no
  // owner left of that type), so this broadcasts to the tenant.
  if (removedRow && REQUIRED_OWNER_TYPES.includes(removedRow.ownerType)) {
    const stillHasType = before.some((o) => o.id !== ownerRowId && o.ownerType === removedRow.ownerType);
    if (!stillHasType) {
      await notify({
        tenantId,
        userId: null,
        type: "ownership_missing",
        title: "Agent missing required ownership",
        body: `An agent no longer has a ${removedRow.ownerType.replace(/_/g, " ")} after an owner was removed.`,
        referenceType: "agent",
        referenceId: agentId,
      });
    }
  }
}

export async function listOwners(tenantId: string, agentId: string): Promise<AgentOwner[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_owners")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .is("removed_at", null);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAgentOwner);
}

/**
 * OPERATIONS-P0-03.1's "owner" search object type — the tenant-wide
 * counterpart to `listOwners()` above, which is deliberately agent-scoped
 * for its own callers (the agent detail page). `agent_owners.user_id` and
 * `.agent_id` are both real FKs (`users(id)`/`agents(id)`, migration
 * 0014), so PostgREST can embed both directly rather than this needing a
 * second round trip or Operations reaching into `users`/`agents` itself
 * (non-negotiable #6) — the embedded names exist only to give a search
 * result a human-readable title/subtitle, nothing else reads them.
 */
export type OwnerWithContext = AgentOwner & {
  userDisplayName: string | null;
  userEmail: string;
  agentName: string;
};

export async function listOwnersForTenant(tenantId: string): Promise<OwnerWithContext[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_owners")
    .select("*, users!agent_owners_user_id_fkey(display_name, email), agents(agent_name)")
    .eq("tenant_id", tenantId)
    .is("removed_at", null);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(
    (row: Record<string, unknown> & { users: { display_name: string | null; email: string } | null; agents: { agent_name: string } | null }) => ({
      ...toAgentOwner(row),
      userDisplayName: row.users?.display_name ?? null,
      userEmail: row.users?.email ?? "",
      agentName: row.agents?.agent_name ?? "",
    }),
  );
}

/**
 * IDENTITY-P0-02.2: exposes ownership *facts* only — never creates a
 * risk_findings row (that is Risk Agent's job once it exists).
 */
export async function getOwnershipIssues(
  tenantId: string,
  agentId: string,
  criticality: "low" | "medium" | "high" | "critical",
): Promise<OwnershipIssue[]> {
  const supabase = await supabaseServer();
  const { data: owners, error } = await supabase
    .from("agent_owners")
    .select("owner_type, user_id, delegation_expires_at")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .is("removed_at", null);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  const rows = (owners ?? []) as { owner_type: AgentOwnerType; user_id: string; delegation_expires_at?: string | null }[];

  // agent_owners.user_id and tenant_memberships.user_id both FK to users.id
  // rather than to each other, so PostgREST can't auto-embed the join —
  // fetch membership status for the relevant users separately and correlate
  // in application code.
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const membershipStatusByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: memberships, error: membershipError } = await supabase
      .from("tenant_memberships")
      .select("user_id, status")
      .eq("tenant_id", tenantId)
      .in("user_id", userIds);
    if (membershipError) throw new ApiError(500, "QUERY_FAILED", membershipError.message);
    for (const m of memberships ?? []) {
      membershipStatusByUser.set(m.user_id, m.status);
    }
  }

  const issues: OwnershipIssue[] = [];
  const byType = new Map<AgentOwnerType, { user_id: string }[]>();
  const byUser = new Map<string, AgentOwnerType[]>();

  for (const row of rows) {
    if (!byType.has(row.owner_type)) byType.set(row.owner_type, []);
    byType.get(row.owner_type)!.push(row);
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id)!.push(row.owner_type);
  }

  for (const required of REQUIRED_OWNER_TYPES) {
    if (!byType.has(required)) {
      issues.push({ type: "missing_owner", ownerType: required as "business_owner" | "technical_owner" });
    }
  }

  if (criticality === "high" || criticality === "critical") {
    for (const recommended of RECOMMENDED_HIGH_RISK_OWNER_TYPES) {
      if (!byType.has(recommended)) {
        issues.push({
          type: "missing_recommended_owner",
          ownerType: recommended as "iam_owner" | "application_owner",
        });
      }
    }
  }

  for (const [userId, ownerTypes] of byUser) {
    if (ownerTypes.length > 1) {
      issues.push({ type: "ownership_conflict", userId, ownerTypes });
    }
  }

  for (const row of rows) {
    const status = membershipStatusByUser.get(row.user_id);
    if (status && status !== "active") {
      issues.push({ type: "inactive_owner", ownerType: row.owner_type, userId: row.user_id });
    }
  }

  // IDENTITY-P0-13: a delegation past its expiry is an ownership gap until removed or renewed.
  const nowIso = new Date().toISOString();
  for (const row of rows) {
    if (row.owner_type === "delegated_owner" && row.delegation_expires_at && row.delegation_expires_at < nowIso) {
      issues.push({ type: "delegation_expired", userId: row.user_id, expiredAt: row.delegation_expires_at });
    }
  }

  return issues;
}

/**
 * IDENTITY-P0-13 — an ownership review: a person confirms the agent's
 * current owners are still right. Stamps every active owner row and is
 * audited. It needs at least the two required owners (a review cannot
 * confirm an incomplete ownership), and it cannot confirm an expired
 * delegation.
 */
export async function reviewOwnership(tenantId: string, actorId: string, agentId: string): Promise<{ confirmed: number }> {
  const owners = await listOwners(tenantId, agentId);
  const types = new Set(owners.map((o) => o.ownerType));
  const missing = REQUIRED_OWNER_TYPES.filter((t) => !types.has(t));
  if (missing.length > 0) {
    throw new ApiError(412, "PRECONDITION_FAILED", `Assign a ${missing.map((t) => t.replace(/_/g, " ")).join(" and ")} before confirming ownership`);
  }
  const nowIso = new Date().toISOString();
  if (owners.some((o) => o.ownerType === "delegated_owner" && o.delegationExpiresAt && o.delegationExpiresAt < nowIso)) {
    throw new ApiError(412, "PRECONDITION_FAILED", "Remove or renew the expired delegation before confirming ownership");
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_owners")
    .update({ last_reviewed_at: nowIso, last_reviewed_by: actorId })
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .is("removed_at", null)
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  // RLS can refuse the update without an error; never report a review
  // that did not happen (§17.5).
  if ((data ?? []).length === 0) throw new ApiError(403, "FORBIDDEN", "You cannot confirm ownership for this agent");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent.ownership_reviewed",
    objectType: "agent",
    objectId: agentId,
    outcome: "success",
    metadata: { confirmedOwners: (data ?? []).length },
  });
  return { confirmed: (data ?? []).length };
}
