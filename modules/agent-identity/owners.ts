import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
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
): Promise<AgentOwner> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_owners")
    .insert({ tenant_id: tenantId, agent_id: agentId, owner_type: ownerType, user_id: userId })
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
    metadata: { ownerType, userId, change: "assigned" },
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
    .select("*, users(display_name, email), agents(agent_name)")
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
    .select("owner_type, user_id")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .is("removed_at", null);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  const rows = (owners ?? []) as { owner_type: AgentOwnerType; user_id: string }[];

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

  return issues;
}
