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

/**
 * IDENTITY-P0-12 — which registered agent a runtime event's agent
 * reference names, for Runtime's ingestion (no user session). Entity
 * resolution by authoritative identifier only (CLAUDE.md §17.6):
 * - a UUID is matched against this tenant's agent ids;
 * - any other reference is matched exactly against this tenant's linked
 *   identities' external references (e.g. a service account or OAuth
 *   client id).
 * No fuzzy or name matching: a reference that matches nothing is
 * "none" (the event becomes Shadow AI evidence), and one whose linked
 * identities belong to more than one agent is "ambiguous" (a person
 * decides; the system never picks the closest match).
 */
export type AgentReferenceResolution =
  | { kind: "unique"; agentId: string; identityId: string | null }
  | { kind: "none" }
  | { kind: "ambiguous"; agentIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveAgentReference(tenantId: string, reference: string): Promise<AgentReferenceResolution> {
  const ref = reference.trim();
  if (!ref) return { kind: "none" };
  const supabase = supabaseServiceRole();

  if (UUID.test(ref)) {
    const { data, error } = await supabase
      .from("agents")
      .select("id, tenant_id")
      .eq("id", ref)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; tenant_id: string }>();
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    return data && data.tenant_id === tenantId ? { kind: "unique", agentId: data.id, identityId: null } : { kind: "none" };
  }

  const { data, error } = await supabase
    .from("agent_identities")
    .select("id, agent_id, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("external_reference", ref)
    .neq("status", "removed")
    .limit(20);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = ((data ?? []) as Array<{ id: string; agent_id: string; tenant_id: string }>).filter((r) => r.tenant_id === tenantId);
  const agentIds = [...new Set(rows.map((r) => r.agent_id))];
  if (agentIds.length === 0) return { kind: "none" };
  if (agentIds.length > 1) return { kind: "ambiguous", agentIds };
  return { kind: "unique", agentId: agentIds[0], identityId: rows.length === 1 ? rows[0].id : null };
}
