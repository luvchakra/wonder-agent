import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { getAgentRuntimeProfile } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { PolicyCondition, RuntimeDecision, RuntimeRequest } from "@/lib/shared/types/access-governance";
import { decideRuntimeRequest, filterToolsForAgent, type RuntimeContractFacts, type RuntimePolicyFacts, type ToolVisibility } from "./runtimeDecision";
import type { AgentContract } from "@/lib/shared/types/agent-identity";

function contractFacts(c: AgentContract): RuntimeContractFacts {
  return {
    approvedApplications: c.approvedApplications,
    approvedData: c.approvedData,
    prohibitedData: c.prohibitedData,
    approvedActions: c.approvedActions,
    prohibitedActions: c.prohibitedActions,
    actionsRequiringApproval: c.actionsRequiringApproval,
    allowedTools: c.allowedTools ?? [],
    autonomyLevel: c.autonomyLevel,
    maximumRisk: c.maximumRisk,
  };
}

/**
 * ACCESS-P0-11 — gathers the facts for decideRuntimeRequest() and returns
 * the decision. Called by the Runtime Gateway (RUNTIME-P0-15) with a
 * principal taken from a verified agent API key, never from the request.
 *
 * A gateway call has no user session, so every read here uses the service
 * role, filters by tenant_id, and re-checks the rows it gets back (§14).
 *
 * Fail-safe (§17.4): if any fact cannot be loaded, the answer is DENY with
 * code EVALUATION_FAILED. It is never ALLOW, and the error is never
 * swallowed silently: it is logged and named in the reason.
 */

export type RuntimePrincipal = { tenantId: string; agentId: string };

const NO_EMERGENCY: RuntimeEmergencyState = { killSwitch: false, suspendedTools: [], suspendedMcpServers: [], terminatedSessions: [] };

/** Emergency controls in force for the tenant (RUNTIME-P0-18, owned and loaded by Runtime). */
export type RuntimeEmergencyState = {
  killSwitch: boolean;
  suspendedTools: string[];
  suspendedMcpServers: string[];
  terminatedSessions: string[];
};

async function loadEffectiveApplications(tenantId: string, agentId: string): Promise<string[]> {
  // One round trip: active grants on this agent's accounts, joined through
  // to application names. `accounts!inner` makes the agent filter apply to
  // the join; both tables are filtered to the key's tenant.
  const { data, error } = await supabaseServiceRole()
    .from("access_grants")
    .select("tenant_id, accounts!inner(agent_id, tenant_id), entitlements(applications(name))")
    .eq("tenant_id", tenantId)
    .eq("accounts.agent_id", agentId)
    .eq("accounts.tenant_id", tenantId)
    .is("revoked_at", null)
    .returns<
      Array<{
        tenant_id: string;
        accounts: { agent_id: string; tenant_id: string } | null;
        entitlements: { applications: { name: string } | null } | null;
      }>
    >();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const names = (data ?? [])
    .filter((g) => g.tenant_id === tenantId && g.accounts?.agent_id === agentId && g.accounts?.tenant_id === tenantId)
    .map((g) => g.entitlements?.applications?.name)
    .filter((n): n is string => Boolean(n));
  return [...new Set(names)];
}

async function loadRuntimePolicies(tenantId: string): Promise<RuntimePolicyFacts[]> {
  // One round trip: active runtime policies with their rules embedded.
  const { data, error } = await supabaseServiceRole()
    .from("policies")
    .select("id, tenant_id, name, action, version, policy_rules(id, condition)")
    .eq("tenant_id", tenantId)
    .eq("policy_category", "runtime")
    .eq("status", "active")
    .returns<
      Array<{
        id: string;
        tenant_id: string;
        name: string;
        action: RuntimePolicyFacts["action"];
        version: number | null;
        policy_rules: Array<{ id: string; condition: PolicyCondition }> | null;
      }>
    >();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? [])
    .filter((p) => p.tenant_id === tenantId)
    .map((p) => ({ id: p.id, version: p.version ?? 1, name: p.name, action: p.action, rules: p.policy_rules ?? [] }));
}

export async function evaluateRuntimeRequest(
  principal: RuntimePrincipal,
  request: RuntimeRequest,
  gateway: {
    tenantActive: boolean;
    /** The gateway's emergency controls. A promise is awaited in the same parallel wave; if it fails, the decision fails closed. */
    emergency?: RuntimeEmergencyState | Promise<RuntimeEmergencyState>;
  },
): Promise<RuntimeDecision> {
  try {
    const [profile, effectiveApplications, runtimePolicies, emergency] = await Promise.all([
      getAgentRuntimeProfile(principal.tenantId, principal.agentId),
      loadEffectiveApplications(principal.tenantId, principal.agentId),
      loadRuntimePolicies(principal.tenantId),
      Promise.resolve(gateway.emergency ?? NO_EMERGENCY),
    ]);

    return decideRuntimeRequest({
      request,
      tenantActive: gateway.tenantActive,
      agent: profile?.agent ?? null,
      identityBelongsToAgent: request.identityId ? Boolean(profile?.identityIds.includes(request.identityId)) : null,
      contract: profile?.contract ? contractFacts(profile.contract) : null,
      effectiveApplications,
      emergency,
      runtimePolicies,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("evaluateRuntimeRequest failed; denying", { tenantId: principal.tenantId, agentId: principal.agentId, error: message });
    return {
      decision: "DENY",
      code: "EVALUATION_FAILED",
      reason: "The decision could not be evaluated, so the request is denied.",
      steps: [],
    };
  }
}

/**
 * RUNTIME-P0-18 — tool visibility for a verified agent, from the same
 * facts as a decision. Any load failure hides every tool (fail closed).
 */
export async function evaluateToolVisibility(
  principal: RuntimePrincipal,
  tools: string[],
  gateway: { tenantActive: boolean; emergency: RuntimeEmergencyState | Promise<RuntimeEmergencyState>; mcpServer?: string },
): Promise<ToolVisibility[]> {
  try {
    const [profile, emergency] = await Promise.all([
      getAgentRuntimeProfile(principal.tenantId, principal.agentId),
      Promise.resolve(gateway.emergency),
    ]);
    return filterToolsForAgent(
      {
        tenantActive: gateway.tenantActive,
        agent: profile?.agent ?? null,
        contract: profile?.contract ? { ...contractFacts(profile.contract) } : null,
        emergency,
      },
      tools,
      gateway.mcpServer,
    );
  } catch (err) {
    console.error("evaluateToolVisibility failed; hiding all tools", { tenantId: principal.tenantId, error: err instanceof Error ? err.message : String(err) });
    return tools.map((tool) => ({ tool, visible: false, code: "EVALUATION_FAILED", reason: "Tool visibility could not be evaluated." }));
  }
}
