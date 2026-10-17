import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { listOwners } from "@/modules/agent-identity/service";
import { notify } from "@/modules/operations/service";
import { delegationDecisionRefusal, validateAgentDelegation, type AgentDelegationInput } from "./agentDelegationRules";

/**
 * ACCESS-P0-23 part 4 — delegation to AI agents (migration 0200). Lists read
 * as the caller under RLS (their own, or all for an access manager); writes
 * use the service role and are filtered by the session's tenant, with every
 * row re-checked (§14). The Runtime Gateway reads active ones in
 * runtimeDecisionLoader.ts.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AgentDelegation = {
  id: string;
  delegatorKind: "user" | "agent";
  delegatorUserId: string | null;
  delegatorAgentId: string | null;
  delegateAgentId: string;
  actions: string[];
  applications: string[];
  reason: string;
  startsAt: string;
  endsAt: string;
  status: "pending" | "active" | "rejected" | "revoked";
  /** Active and not yet ended. */
  inForce: boolean;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

function toDelegation(r: Row, now = new Date()): AgentDelegation {
  const status = r.status as AgentDelegation["status"];
  return {
    id: r.id as string,
    delegatorKind: r.delegator_kind as "user" | "agent",
    delegatorUserId: (r.delegator_user_id as string | null) ?? null,
    delegatorAgentId: (r.delegator_agent_id as string | null) ?? null,
    delegateAgentId: r.delegate_agent_id as string,
    actions: (r.actions as string[]) ?? [],
    applications: (r.applications as string[]) ?? [],
    reason: r.reason as string,
    startsAt: r.starts_at as string,
    endsAt: r.ends_at as string,
    status,
    inForce: status === "active" && Date.parse(r.starts_at as string) <= now.getTime() && Date.parse(r.ends_at as string) > now.getTime(),
    requestedBy: r.requested_by as string,
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
  };
}

type Caller = { userId: string; canManageAccess: boolean };

async function currentOwners(tenantId: string, agentId: string): Promise<string[]> {
  return [...new Set((await listOwners(tenantId, agentId)).filter((o) => !o.removedAt).map((o) => o.userId))];
}

async function agentInTenant(tenantId: string, agentId: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabaseServiceRole().from("agents").select("id, tenant_id, agent_name, display_name").eq("tenant_id", tenantId).eq("id", agentId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data && data.tenant_id === tenantId ? { id: data.id as string, name: (data.display_name as string | null) || (data.agent_name as string) } : null;
}

/** The delegations the caller asked for or gives, those waiting for them as an agent owner, and (for an access manager) all; not ended ones. */
export async function listAgentDelegations(tenantId: string, caller: Caller): Promise<{ mine: AgentDelegation[]; toDecide: AgentDelegation[] }> {
  const supabase = await supabaseServer();
  const nowIso = new Date().toISOString();
  const [own, pending, owned] = await Promise.all([
    supabase.from("agent_delegations").select("*").eq("tenant_id", tenantId).in("status", ["pending", "active"]).gt("ends_at", nowIso).order("created_at", { ascending: false }).limit(200),
    supabaseServiceRole().from("agent_delegations").select("*").eq("tenant_id", tenantId).eq("status", "pending").gt("ends_at", nowIso).limit(200),
    supabaseServiceRole().from("agent_owners").select("tenant_id, agent_id").eq("tenant_id", tenantId).eq("user_id", caller.userId).is("removed_at", null),
  ]);
  if (own.error || pending.error || owned.error) throw new ApiError(500, "QUERY_FAILED", (own.error ?? pending.error ?? owned.error)!.message);
  const myAgents = new Set(((owned.data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => r.agent_id as string));
  const toDecide = ((pending.data ?? []) as Row[])
    .filter((r) => r.tenant_id === tenantId && r.requested_by !== caller.userId && (myAgents.has(r.delegate_agent_id as string) || caller.canManageAccess))
    .map((r) => toDelegation(r));
  return { mine: ((own.data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => toDelegation(r)), toDecide };
}

/** Asks for a delegation; it waits for an owner of the receiving agent (owner decision 2026-10-17). */
export async function requestAgentDelegation(tenantId: string, caller: Caller, input: AgentDelegationInput): Promise<AgentDelegation> {
  const v = validateAgentDelegation(input, caller.userId, new Date());
  if ("error" in v) throw new ApiError(400, "VALIDATION_FAILED", v.error);
  const delegate = await agentInTenant(tenantId, v.delegate_agent_id);
  if (!delegate) throw new ApiError(404, "NOT_FOUND", "That agent is not in this organization");
  if (v.delegator_agent_id) {
    if (!(await agentInTenant(tenantId, v.delegator_agent_id))) throw new ApiError(404, "NOT_FOUND", "That agent is not in this organization");
    // Only an owner of the agent that delegates (or an access manager) speaks for it.
    if (!caller.canManageAccess && !(await currentOwners(tenantId, v.delegator_agent_id)).includes(caller.userId)) {
      throw new ApiError(403, "FORBIDDEN", "Only an owner of an agent can delegate for it");
    }
  }
  const admin = supabaseServiceRole();
  const { data: member, error: memberError } = await admin.from("tenant_memberships").select("tenant_id, status, account_type").eq("tenant_id", tenantId).eq("user_id", caller.userId).maybeSingle();
  if (memberError) throw new ApiError(500, "QUERY_FAILED", memberError.message);
  if (!member || member.status !== "active") throw new ApiError(403, "FORBIDDEN", "Only an active member can delegate");
  if (member.account_type === "automation") throw new ApiError(409, "AUTOMATION_MEMBER", "An automation credential cannot delegate to an agent");
  const { data, error } = await admin
    .from("agent_delegations")
    .insert({ tenant_id: tenantId, ...v, status: "pending", requested_by: caller.userId })
    .select("*")
    .single();
  if (error || !data) throw new ApiError(error?.code === "23514" ? 400 : 500, "WRITE_FAILED", error?.message ?? "Could not save");
  await writeAudit({
    tenantId,
    actorId: caller.userId,
    actorType: "user",
    action: "access.agent_delegation_requested",
    objectType: "agent_delegation",
    objectId: data.id as string,
    outcome: "success",
    metadata: { delegatorKind: v.delegator_kind, delegatorAgentId: v.delegator_agent_id, delegateAgentId: v.delegate_agent_id, actions: v.actions, applications: v.applications, endsAt: v.ends_at },
    typedText: { reason: v.reason },
  });
  for (const owner of (await currentOwners(tenantId, v.delegate_agent_id)).filter((o) => o !== caller.userId)) {
    await notify({
      tenantId,
      userId: owner,
      type: "approval_required",
      title: `Approve a delegation to ${delegate.name}`,
      body: `${delegate.name} would act ${v.delegator_kind === "user" ? "for a person" : "for another agent"} for: ${v.actions.join(", ")}. Decide it under Access › Delegations.`,
      referenceType: "agent_delegation",
      referenceId: data.id as string,
    });
  }
  return toDelegation(data);
}

/** Approves or rejects a waiting delegation. Never the asker's own; an owner of the receiving agent decides. */
export async function decideAgentDelegation(tenantId: string, caller: Caller, delegationId: string, decision: unknown, note?: unknown): Promise<AgentDelegation> {
  if (!UUID_RE.test(delegationId)) throw new ApiError(404, "NOT_FOUND", "No such delegation");
  if (decision !== "approve" && decision !== "reject") throw new ApiError(400, "VALIDATION_FAILED", "decision: approve or reject");
  const admin = supabaseServiceRole();
  const { data: row, error } = await admin.from("agent_delegations").select("*").eq("tenant_id", tenantId).eq("id", delegationId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!row || row.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such delegation");
  const refusal = delegationDecisionRefusal({ status: row.status as string, requestedBy: row.requested_by as string }, caller, await currentOwners(tenantId, row.delegate_agent_id as string));
  if (refusal) throw new ApiError(row.status === "pending" ? 403 : 409, row.status === "pending" ? "FORBIDDEN" : "INVALID_TRANSITION", refusal);
  const decisionNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 1000) : null;
  if (decision === "reject" && !decisionNote) throw new ApiError(400, "VALIDATION_FAILED", "Say why it is rejected");
  const { data, error: updateError } = await admin
    .from("agent_delegations")
    .update({ status: decision === "approve" ? "active" : "rejected", decided_by: caller.userId, decided_at: new Date().toISOString(), decision_note: decisionNote })
    .eq("tenant_id", tenantId)
    .eq("id", delegationId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (updateError) throw new ApiError(500, "WRITE_FAILED", updateError.message);
  if (!data) throw new ApiError(409, "INVALID_TRANSITION", "Decided meanwhile; reload");
  await writeAudit({
    tenantId,
    actorId: caller.userId,
    actorType: "user",
    action: decision === "approve" ? "access.agent_delegation_approved" : "access.agent_delegation_rejected",
    objectType: "agent_delegation",
    objectId: delegationId,
    outcome: "success",
    metadata: { delegateAgentId: row.delegate_agent_id, requestedBy: row.requested_by },
    typedText: { note: decisionNote },
  });
  return toDelegation(data);
}

/** Ends a delegation now (or withdraws a waiting one): its asker, the person it is from, an owner of the agent, or an access manager. */
export async function revokeAgentDelegation(tenantId: string, caller: Caller, delegationId: string): Promise<AgentDelegation> {
  if (!UUID_RE.test(delegationId)) throw new ApiError(404, "NOT_FOUND", "No such delegation");
  const admin = supabaseServiceRole();
  const { data: row, error } = await admin.from("agent_delegations").select("*").eq("tenant_id", tenantId).eq("id", delegationId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!row || row.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such delegation");
  const allowed =
    caller.canManageAccess ||
    caller.userId === row.requested_by ||
    caller.userId === row.delegator_user_id ||
    (await currentOwners(tenantId, row.delegate_agent_id as string)).includes(caller.userId);
  if (!allowed) throw new ApiError(404, "NOT_FOUND", "No such delegation");
  if (row.status !== "pending" && row.status !== "active") throw new ApiError(409, "INVALID_TRANSITION", "This delegation has already ended");
  const now = new Date().toISOString();
  const { data, error: updateError } = await admin
    .from("agent_delegations")
    .update({ status: "revoked", revoked_at: now, revoked_by: caller.userId, ...(row.status === "pending" ? { decided_at: now } : {}) })
    .eq("tenant_id", tenantId)
    .eq("id", delegationId)
    .eq("status", row.status)
    .select("*")
    .maybeSingle();
  if (updateError) throw new ApiError(500, "WRITE_FAILED", updateError.message);
  if (!data) throw new ApiError(409, "INVALID_TRANSITION", "Changed meanwhile; reload");
  await writeAudit({
    tenantId,
    actorId: caller.userId,
    actorType: "user",
    action: "access.agent_delegation_revoked",
    objectType: "agent_delegation",
    objectId: delegationId,
    outcome: "success",
    metadata: { delegateAgentId: row.delegate_agent_id, wasStatus: row.status },
  });
  return toDelegation(data);
}
