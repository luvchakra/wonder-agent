import "server-only";

import { getAgentContract } from "@/modules/agent-identity/service";
import { getEffectiveAccess, listPolicyEvaluations } from "@/modules/access-governance/service";
import { getFindings } from "@/modules/risk/service";
import { getDid } from "@/modules/runtime-assurance/service";
import type { AgentContract } from "@/lib/shared/types/agent-identity";
import type { AccessGrant, PolicyEvaluationResult } from "@/lib/shared/types/access-governance";
import type { RiskFinding, RiskSeverity } from "@/lib/shared/types/risk";
import type { CertificationSnapshot, UsageAtReview } from "@/lib/shared/types/compliance";

// RISK-P0-02.2's `info` tier ranks below `low` here, same as campaigns.ts's
// SEVERITY_RANK — kept in sync deliberately since both answer "what's the
// worst open finding for this agent."
const SEVERITY_RANK: Record<RiskSeverity, number> = { info: -1, low: 0, medium: 1, high: 2, critical: 3 };

/** COMPLIANCE-P0-03 — pure. The worst (highest-ranked) severity among the given findings, or null if there are none. */
export function computeWorstSeverity(findings: Pick<RiskFinding, "severity">[]): RiskSeverity | null {
  return findings.reduce<RiskSeverity | null>((worst, f) => {
    if (!worst || SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) return f.severity;
    return worst;
  }, null);
}

/**
 * COMPLIANCE-P0-03 — pure. `used` if any DID tuple touched this
 * application; `unknown` only when there's no DID or finding data at all to
 * judge against; `never` otherwise. Mirrors COMPLIANCE-P0-01.2's original
 * inline rule exactly (same three-way outcome, same "no data at all"
 * carve-out for `unknown`).
 */
export function computeUsageForApplication(
  didTuples: { application: string | null }[],
  hasFindings: boolean,
  application: string | undefined,
): UsageAtReview {
  if (didTuples.length === 0 && !hasFindings) return "unknown";
  return didTuples.some((t) => t.application === application) ? "used" : "never";
}

/** COMPLIANCE-P0-03 — pure. Shapes a snapshot from already-fetched inputs; no I/O. */
export function shapeCertificationSnapshot(input: {
  contract: AgentContract | null;
  grant: AccessGrant | null;
  policyEvaluations: PolicyEvaluationResult[];
  riskAtReview: RiskSeverity | null;
  usageAtReview: UsageAtReview;
}): CertificationSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    agentContractId: input.contract?.id ?? null,
    agentContractVersion: input.contract?.version ?? null,
    accessGrant: input.grant
      ? {
          id: input.grant.id,
          application: input.grant.application,
          entitlementName: input.grant.entitlementName,
          dataClassification: input.grant.dataClassification ?? null,
        }
      : null,
    policyEvaluations: input.policyEvaluations.map((e) => ({ policyId: e.policyId, policyVersion: e.policyVersion, result: e.result })),
    riskAtReview: input.riskAtReview,
    usageAtReview: input.usageAtReview,
  };
}

/**
 * COMPLIANCE-P0-03. Fetches every input fresh (current contract, effective
 * access, policy evaluations, open findings, DID) and shapes a snapshot —
 * used by `recordDecision()` so a decision's snapshot reflects what was
 * true at the moment the reviewer acted, which may differ from the item's
 * population-time `risk_at_review`/`usage_at_review` columns if the
 * agent's contract or policies changed in between.
 */
export async function buildFreshSnapshot(tenantId: string, agentId: string, accessGrantId: string | null): Promise<CertificationSnapshot> {
  const [contract, effectiveAccess, policyEvaluations, findings, did] = await Promise.all([
    getAgentContract(agentId),
    getEffectiveAccess(tenantId, agentId),
    listPolicyEvaluations(tenantId, agentId),
    getFindings(tenantId, { agentId, status: "open" }),
    getDid(tenantId, agentId),
  ]);

  const grant = accessGrantId ? (effectiveAccess.find((g) => g.id === accessGrantId) ?? null) : null;
  const riskAtReview = computeWorstSeverity(findings);
  const usageAtReview = computeUsageForApplication(did.tuples, findings.length > 0, grant?.application);

  return shapeCertificationSnapshot({ contract, grant, policyEvaluations, riskAtReview, usageAtReview });
}
