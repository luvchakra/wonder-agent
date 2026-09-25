import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AgentContract } from "@/lib/shared/types/agent-identity";
import { toAgentContract } from "./mappers";

/**
 * Published for the Runtime Gateway (ACCESS-P0-11 / RUNTIME-P0-15, user
 * decision 2026-09-25). A gateway call carries an agent API key, not a user
 * session, so the user-scoped readers (getAgent, getAgentContract) would
 * see nothing under RLS. This is the system read of exactly what a runtime
 * decision needs: the agent's lifecycle, environment and risk, its active
 * contract, and its linked identity ids.
 *
 * It uses the service role, so every query filters by tenant_id and every
 * row is re-checked before it is returned (CLAUDE.md §14). The tenant and
 * agent must come from a verified agent API key, never from a request.
 */
export type AgentRuntimeProfile = {
  agent: { id: string; lifecycleState: string; environment: string; criticality: string; riskScore: number | null };
  contract: AgentContract | null;
  identityIds: string[];
};

export async function getAgentRuntimeProfile(tenantId: string, agentId: string): Promise<AgentRuntimeProfile | null> {
  const supabase = supabaseServiceRole();
  const [agentRes, contractRes, identitiesRes] = await Promise.all([
    supabase
      .from("agents")
      .select("id, tenant_id, lifecycle_state, environment, criticality, risk_score")
      .eq("id", agentId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; tenant_id: string; lifecycle_state: string; environment: string; criticality: string; risk_score: number | null }>(),
    supabase.from("agent_contracts").select().eq("agent_id", agentId).eq("tenant_id", tenantId).eq("status", "active").maybeSingle(),
    supabase.from("agent_identities").select("id, tenant_id").eq("agent_id", agentId).eq("tenant_id", tenantId).neq("status", "removed"),
  ]);
  if (agentRes.error) throw new ApiError(500, "QUERY_FAILED", agentRes.error.message);
  if (contractRes.error) throw new ApiError(500, "QUERY_FAILED", contractRes.error.message);
  if (identitiesRes.error) throw new ApiError(500, "QUERY_FAILED", identitiesRes.error.message);

  const agent = agentRes.data;
  if (!agent || agent.tenant_id !== tenantId) return null;
  const contract = contractRes.data && contractRes.data.tenant_id === tenantId ? toAgentContract(contractRes.data) : null;

  return {
    agent: {
      id: agent.id,
      lifecycleState: agent.lifecycle_state,
      environment: agent.environment,
      criticality: agent.criticality,
      riskScore: agent.risk_score === null ? null : Number(agent.risk_score),
    },
    contract,
    identityIds: ((identitiesRes.data ?? []) as Array<{ id: string; tenant_id: string }>).filter((i) => i.tenant_id === tenantId).map((i) => i.id),
  };
}

/**
 * OPERATIONS-P0-08 — the agent's display name for a runtime notification
 * raised after a gateway decision, where no user session exists. Same
 * service-role discipline as above: filtered by tenant and re-checked.
 * Returns null if the agent is not in this tenant.
 */
export async function getAgentDisplayName(tenantId: string, agentId: string): Promise<string | null> {
  const { data, error } = await supabaseServiceRole()
    .from("agents")
    .select("agent_name, tenant_id")
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ agent_name: string; tenant_id: string }>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data && data.tenant_id === tenantId ? data.agent_name : null;
}
