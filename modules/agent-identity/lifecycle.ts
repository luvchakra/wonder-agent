import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { Agent, AgentLifecycleEvent, AgentLifecycleState } from "@/lib/shared/types/agent-identity";
import { toAgent, toAgentLifecycleEvent } from "./mappers";

export type LifecycleActor = {
  actorType: "user" | "system";
  actorId?: string | null;
  roles?: string[];
};

/**
 * IDENTITY-P0-02.1's allowed-transition table, reproduced here as the single
 * source of truth the validator below checks against. Kept as data (not
 * scattered if/else) so the whole state machine is readable in one place.
 */
const NORMAL_TRANSITIONS: Partial<Record<AgentLifecycleState, AgentLifecycleState[]>> = {
  DISCOVERED: ["REGISTERED"],
  REGISTERED: ["APPROVED"],
  APPROVED: ["PROVISIONED"],
  PROVISIONED: ["ACTIVE"],
  ACTIVE: ["CERTIFICATION_DUE", "RESTRICTED"],
  CERTIFICATION_DUE: ["ACTIVE"],
  RESTRICTED: ["SUSPENDED"],
  SUSPENDED: ["RETIRED"],
};

const EMERGENCY_SUSPEND_ROLES = ["SECURITY_ADMIN", "TENANT_SUPER_ADMIN"];
const RESTRICTED_TO_SUSPENDED_ROLES = ["SECURITY_ADMIN", "IAM_ADMIN", "TENANT_SUPER_ADMIN"];
const APPROVAL_ROLES = ["IAM_ADMIN", "TENANT_SUPER_ADMIN"];

function hasAnyRole(actor: LifecycleActor, allowed: string[]): boolean {
  return (actor.roles ?? []).some((r) => allowed.includes(r));
}

/**
 * Pure structural check against IDENTITY-P0-02.1's transition table —
 * exported so the state machine's shape is unit-testable without a database.
 * Does not check role/DB preconditions; see validateTransition() for those.
 *
 * "any state -> SUSPENDED" is a wildcard emergency path. RETIRED is
 * terminal — nothing transitions out of it, including into SUSPENDED (this
 * reading is Identity Agent's own judgment call, not stated explicitly
 * either way in the backlog; recorded in the audit log rather than left
 * silent).
 */
export function isStructurallyAllowedTransition(
  fromState: AgentLifecycleState,
  toState: AgentLifecycleState,
): boolean {
  if (toState === "SUSPENDED") return fromState !== "RETIRED";
  return (NORMAL_TRANSITIONS[fromState] ?? []).includes(toState);
}

/**
 * Validates a requested transition against IDENTITY-P0-02.1's table and
 * preconditions. Throws ApiError(409, "INVALID_TRANSITION") for a transition
 * not in the table at all, or ApiError(412, "PRECONDITION_FAILED") for a
 * structurally valid transition whose precondition isn't met yet.
 */
async function validateTransition(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role Supabase client
  supabase: any,
  tenantId: string,
  agent: Agent,
  toState: AgentLifecycleState,
  actor: LifecycleActor,
): Promise<void> {
  const fromState = agent.lifecycleState;

  if (!isStructurallyAllowedTransition(fromState, toState)) {
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      `Cannot transition from ${fromState} to ${toState}`,
    );
  }

  if (toState === "SUSPENDED") {
    if (fromState === "RESTRICTED") {
      if (actor.actorType === "user" && !hasAnyRole(actor, RESTRICTED_TO_SUSPENDED_ROLES)) {
        throw new ApiError(
          412,
          "PRECONDITION_FAILED",
          `RESTRICTED -> SUSPENDED requires one of: ${RESTRICTED_TO_SUSPENDED_ROLES.join(", ")}`,
        );
      }
      return;
    }
    if (actor.actorType === "user" && !hasAnyRole(actor, EMERGENCY_SUSPEND_ROLES)) {
      throw new ApiError(
        412,
        "PRECONDITION_FAILED",
        `Emergency suspension requires one of: ${EMERGENCY_SUSPEND_ROLES.join(", ")}`,
      );
    }
    return;
  }

  if (fromState === "DISCOVERED" && toState === "REGISTERED") {
    if (!agent.purpose?.trim()) {
      throw new ApiError(412, "PRECONDITION_FAILED", "Agent must have a purpose set");
    }
    if (!agent.sourceSystem) {
      throw new ApiError(412, "PRECONDITION_FAILED", "Agent must have a source_system set");
    }
    const { data: owners, error } = await supabase
      .from("agent_owners")
      .select("owner_type")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agent.id)
      .is("removed_at", null);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const ownerTypes = new Set((owners ?? []).map((o: { owner_type: string }) => o.owner_type));
    if (!ownerTypes.has("business_owner") || !ownerTypes.has("technical_owner")) {
      throw new ApiError(
        412,
        "PRECONDITION_FAILED",
        "Agent requires an active business_owner and technical_owner",
      );
    }
  }

  if (fromState === "REGISTERED" && toState === "APPROVED") {
    const { data: contract, error } = await supabase
      .from("agent_contracts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agent.id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    if (!contract) {
      throw new ApiError(412, "PRECONDITION_FAILED", "agent contract required");
    }

    if (actor.actorType === "user" && !hasAnyRole(actor, APPROVAL_ROLES)) {
      const { data: ownerRow, error: ownerError } = await supabase
        .from("agent_owners")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("agent_id", agent.id)
        .eq("user_id", actor.actorId)
        .is("removed_at", null)
        .maybeSingle();
      if (ownerError) throw new ApiError(500, "QUERY_FAILED", ownerError.message);
      if (!ownerRow) {
        throw new ApiError(
          412,
          "PRECONDITION_FAILED",
          "Approval requires an agent owner or IAM_ADMIN/TENANT_SUPER_ADMIN",
        );
      }
    }
  }

  if (fromState === "ACTIVE" && toState === "CERTIFICATION_DUE" && actor.actorType !== "system") {
    throw new ApiError(
      412,
      "PRECONDITION_FAILED",
      "ACTIVE -> CERTIFICATION_DUE is system-triggered only",
    );
  }
}

/**
 * IDENTITY-P0-02.1 (higher bar). Runs via the service-role client because
 * agent_lifecycle_events has no client-facing write policy (see
 * supabase/migrations/0015_identity_agent_lifecycle_events.sql) — so every
 * query in here explicitly filters/stamps tenant_id itself; RLS is not doing
 * that job for this function.
 */
export async function transitionAgentLifecycle(
  tenantId: string,
  agentId: string,
  toState: AgentLifecycleState,
  reason: string,
  actor: LifecycleActor,
): Promise<Agent> {
  if (!reason.trim()) {
    throw new ApiError(400, "INVALID_INPUT", "reason is required");
  }

  const supabase = supabaseServiceRole();

  const { data: agentRow, error: fetchError } = await supabase
    .from("agents")
    .select()
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (fetchError) throw new ApiError(500, "QUERY_FAILED", fetchError.message);
  if (!agentRow) throw new ApiError(404, "AGENT_NOT_FOUND");

  const agent = toAgent(agentRow);
  await validateTransition(supabase, tenantId, agent, toState, actor);

  const updates: Record<string, unknown> = { lifecycle_state: toState, status: toState.toLowerCase() };
  if (toState === "ACTIVE" && !agent.activatedAt) updates.activated_at = new Date().toISOString();
  if (toState === "RETIRED") updates.retirement_date = new Date().toISOString();

  const { data: updatedRow, error: updateError } = await supabase
    .from("agents")
    .update(updates)
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .select()
    .single();
  if (updateError || !updatedRow) {
    throw new ApiError(500, "UPDATE_FAILED", updateError?.message ?? "Failed to update agent");
  }

  const { error: eventError } = await supabase.from("agent_lifecycle_events").insert({
    tenant_id: tenantId,
    agent_id: agentId,
    from_state: agent.lifecycleState,
    to_state: toState,
    reason,
    actor_id: actor.actorId ?? null,
    actor_type: actor.actorType,
  });
  if (eventError) {
    throw new ApiError(500, "EVENT_WRITE_FAILED", eventError.message);
  }

  await writeAudit({
    tenantId,
    actorId: actor.actorId ?? null,
    actorType: actor.actorType,
    action: "agent.lifecycle_transitioned",
    objectType: "agent",
    objectId: agentId,
    outcome: "success",
    metadata: { fromState: agent.lifecycleState, toState, reason },
  });

  return toAgent(updatedRow);
}

export async function listLifecycleEvents(
  tenantId: string,
  agentId: string,
): Promise<AgentLifecycleEvent[]> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("agent_lifecycle_events")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAgentLifecycleEvent);
}

/**
 * IDENTITY-P0-02.1: "ACTIVE -> CERTIFICATION_DUE ... can be computed on read
 * rather than requiring a background cron." Called from getAgent()/
 * listAgents() rather than a scheduled job.
 */
export async function maybeMarkCertificationDue(tenantId: string, agent: Agent): Promise<Agent> {
  if (agent.lifecycleState !== "ACTIVE" || !agent.nextReviewAt) return agent;
  if (new Date(agent.nextReviewAt).getTime() > Date.now()) return agent;

  try {
    return await transitionAgentLifecycle(
      tenantId,
      agent.id,
      "CERTIFICATION_DUE",
      "next_review_at elapsed",
      { actorType: "system" },
    );
  } catch {
    // If the transition can't be applied for any reason, surface the agent
    // as originally read rather than fail the caller's read entirely.
    return agent;
  }
}
