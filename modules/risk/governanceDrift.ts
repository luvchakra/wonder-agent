import "server-only";

import { listContractVersions, listOwners } from "@/modules/agent-identity/service";
import { getEffectiveAccess, getEffectiveAccessAsOf } from "@/modules/access-governance/service";
import type { Agent, AgentContract, AgentIdentityLink, AgentLifecycleEvent } from "@/lib/shared/types/agent-identity";
import type { EvidenceType } from "@/lib/shared/types/risk";

type DriftEvidence = { evidenceType: EvidenceType; referenceId: string; summary: string };

export type DriftTrigger = {
  category: "governance_drift";
  title: string;
  explanation: string;
  recommendation: string;
  evidence: DriftEvidence[];
};

/**
 * RISK-P0-04 — Governance Drift detection. Diffs the agent's current
 * governed state against its state as of its most recent APPROVED
 * transition (the last point governance affirmed a baseline) — the same
 * "diff current state against a reference point already tracked by another
 * module" pattern RISK-P0-01.2's existing lifecycle_violation category
 * already uses (its own reference point: the most recent transition INTO
 * the current terminal state). No new snapshot table; reuses
 * risk_findings/risk_evidence per the story's own instruction.
 *
 * Sub-signals covered: purpose changed, autonomy level increased, new
 * allowed tool, new approved action, owner added, IAM identity linked,
 * access expanded — all directly derivable from Identity's/Access's
 * already-published contracts. Deliberately NOT covered (documented, not
 * silently skipped): "new tool/data source" beyond `allowedTools` and
 * "runtime behavior changed" as a distinct drift signal — the former has
 * no other published "first seen since timestamp" contract to read from
 * without reaching into Runtime's internals (non-negotiable #6), and the
 * latter would duplicate the already-existing `behavioral_deviation`
 * category rather than add a new signal (no module may invent a second
 * concept for the same thing).
 */
export async function detectGovernanceDrift(
  tenantId: string,
  agent: Agent,
  contract: AgentContract | null,
  identities: AgentIdentityLink[],
  lifecycleEvents: AgentLifecycleEvent[],
): Promise<DriftTrigger | null> {
  if (!contract) return null;

  const approvalEvent = [...lifecycleEvents].reverse().find((e) => e.toState === "APPROVED");
  if (!approvalEvent) return null; // never approved — no baseline to diff against yet

  const referenceTime = approvalEvent.createdAt;

  const [versions, owners, accessThen, accessNow] = await Promise.all([
    listContractVersions(tenantId, agent.id),
    listOwners(tenantId, agent.id),
    getEffectiveAccessAsOf(tenantId, agent.id, referenceTime),
    getEffectiveAccess(tenantId, agent.id),
  ]);

  const referenceContract = [...versions].filter((v) => v.createdAt <= referenceTime).sort((a, b) => b.version - a.version)[0] ?? versions[0];
  if (!referenceContract) return null;

  const evidence: DriftEvidence[] = [];
  const changes: string[] = [];

  if (referenceContract.purpose !== contract.purpose) {
    changes.push("purpose changed");
    evidence.push({ evidenceType: "governance_baseline", referenceId: contract.id, summary: `purpose: "${referenceContract.purpose}" -> "${contract.purpose}"` });
  }

  if (contract.autonomyLevel > referenceContract.autonomyLevel) {
    changes.push(`autonomy level increased (${referenceContract.autonomyLevel} -> ${contract.autonomyLevel})`);
    evidence.push({ evidenceType: "governance_baseline", referenceId: contract.id, summary: `autonomyLevel: ${referenceContract.autonomyLevel} -> ${contract.autonomyLevel}` });
  }

  const newTools = contract.allowedTools.filter((t) => !referenceContract.allowedTools.includes(t));
  if (newTools.length > 0) {
    changes.push(`new allowed tool(s): ${newTools.join(", ")}`);
    evidence.push({ evidenceType: "governance_baseline", referenceId: contract.id, summary: `allowedTools gained: ${newTools.join(", ")}` });
  }

  const newActions = contract.approvedActions.filter((a) => !referenceContract.approvedActions.includes(a));
  if (newActions.length > 0) {
    changes.push(`new approved action(s): ${newActions.join(", ")}`);
    evidence.push({ evidenceType: "governance_baseline", referenceId: contract.id, summary: `approvedActions gained: ${newActions.join(", ")}` });
  }

  const newOwners = owners.filter((o) => o.assignedAt > referenceTime);
  if (newOwners.length > 0) {
    changes.push(`owner(s) added: ${newOwners.map((o) => o.ownerType).join(", ")}`);
    for (const o of newOwners) {
      evidence.push({ evidenceType: "governance_baseline", referenceId: o.id, summary: `${o.ownerType} assigned ${o.assignedAt}` });
    }
  }

  const newIdentities = identities.filter((i) => i.createdAt > referenceTime);
  if (newIdentities.length > 0) {
    changes.push(`new IAM identity linked: ${newIdentities.map((i) => i.externalReference).join(", ")}`);
    for (const i of newIdentities) {
      evidence.push({ evidenceType: "governance_baseline", referenceId: i.id, summary: `${i.identityType} ${i.externalReference} linked ${i.createdAt}` });
    }
  }

  const grantsThenIds = new Set(accessThen.map((g) => g.id));
  const newGrants = accessNow.filter((g) => !grantsThenIds.has(g.id));
  if (newGrants.length > 0) {
    changes.push(`access expanded: ${newGrants.length} new grant(s)`);
    for (const g of newGrants) {
      evidence.push({ evidenceType: "access_grant", referenceId: g.id, summary: `${g.application ?? "?"}/${g.entitlementName} granted since approval` });
    }
  }

  if (changes.length === 0) return null;

  return {
    category: "governance_drift",
    title: `${agent.agentName}'s governed state has drifted since its last approval`,
    explanation: `${agent.agentName} was approved on ${referenceTime}. Since then: ${changes.join("; ")}.`,
    recommendation: `Review these changes against ${agent.agentName}'s approved contract and consider a re-certification or an updated contract version.`,
    evidence,
  };
}
