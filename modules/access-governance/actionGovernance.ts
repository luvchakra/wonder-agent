import "server-only";

import { getAgentContract } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ActionGovernanceResult, ActionGovernanceState } from "@/lib/shared/types/access-governance";

type ActionGovernanceContract = {
  approvedActions: string[];
  prohibitedActions: string[];
  actionsRequiringApproval: string[];
};

/**
 * ACCESS-P0-06 — Action Governance's 4-state model (governance
 * requirements reconciliation, 2026-09-15's Human Oversight / Autonomy
 * decision: "Identity + Access", Access's half). Deterministic and
 * explainable (non-negotiable #9): prohibited beats requires-approval beats
 * approved, and anything not explicitly approved defaults to `restricted`
 * (never silently `allowed`) — an agent contract that never mentions an
 * action has not authorized it. Pure function, extracted so the
 * classification rule is unit-testable without a database — same pattern
 * as `classifyAccessGrant()` in `comparison.ts`.
 */
export function classifyAction(contract: ActionGovernanceContract, action: string): ActionGovernanceState {
  const needle = action.trim().toLowerCase();
  const prohibited = new Set(contract.prohibitedActions.map((a) => a.trim().toLowerCase()));
  const requiresApproval = new Set(contract.actionsRequiringApproval.map((a) => a.trim().toLowerCase()));
  const approved = new Set(contract.approvedActions.map((a) => a.trim().toLowerCase()));

  if (prohibited.has(needle)) return "prohibited";
  if (requiresApproval.has(needle)) return "allowed_with_approval";
  if (approved.has(needle)) return "allowed";
  return "restricted";
}

/**
 * Classifies a list of actions against an agent's active contract. When
 * `actions` is omitted, classifies the union of every action the contract
 * itself names (approved + prohibited + requires-approval) — a full
 * picture of the agent's declared action governance without the caller
 * needing to already know which actions matter.
 */
export async function classifyActionsForAgent(agentId: string, actions?: string[]): Promise<ActionGovernanceResult[]> {
  const contract = await getAgentContract(agentId);
  if (!contract) throw new ApiError(404, "NO_ACTIVE_CONTRACT", "Agent has no active contract to evaluate actions against");

  const list =
    actions && actions.length > 0
      ? actions
      : [...new Set([...contract.approvedActions, ...contract.prohibitedActions, ...contract.actionsRequiringApproval])];

  return list.map((action) => ({ action, state: classifyAction(contract, action) }));
}
