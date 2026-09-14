import "server-only";

import { getAgent, getAgentContract, getOwnershipIssues, listAgentIdentities, listLifecycleEvents, transitionAgentLifecycle } from "@/modules/agent-identity/service";
import { listPolicyEvaluations } from "@/modules/access-governance/service";
import { compareShouldCanDid, getDid, listRuntimeEvents } from "@/modules/runtime-assurance/service";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { EvidenceType, RiskFactor, RiskFinding, RogueCategory } from "@/lib/shared/types/risk";
import { applyProhibitedDataOverride, computeSeverity, resolveWeight } from "./scoring";
import { createOrUpdateFinding } from "./findings";
import { getSeverityWeights } from "./config";

const SENSITIVE_KEYWORDS = ["pii", "financial", "confidential"];

/**
 * RISK-P0-01.4 — bump this whenever the deterministic detection logic in
 * this file materially changes, so a finding's evidence pack can show
 * exactly which version of the rule produced it. Existing rows backfill to
 * 1 via the column default (migration 0044) rather than a separate data
 * migration, per the story's own documented allowance.
 */
export const EVALUATOR_VERSION = 1;

/**
 * Same case-insensitive-substring vocabulary bridge Runtime Agent's own
 * compareShouldCanDid() uses (contract free text like "financial reporting"
 * vs. a short data_classification code like "financial"/"pii") — documented
 * there, reproduced here as a small self-contained helper rather than
 * reaching into Runtime's internals (non-negotiable #6).
 */
function classificationsCompatible(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

function isSensitiveClassification(c: string | null | undefined): boolean {
  if (!c) return false;
  const lower = c.toLowerCase();
  return SENSITIVE_KEYWORDS.some((k) => lower.includes(k));
}

type Trigger = {
  category: RogueCategory;
  title: string;
  explanation: string;
  recommendation: string;
  evidence: { evidenceType: EvidenceType; referenceId: string; summary: string }[];
  isProhibitedDataViolation?: boolean;
};

/**
 * RISK-P0-01.2 + RISK-P0-02.1. Runs all eight deterministic detection
 * categories for one agent and creates/updates the corresponding findings.
 * Pure consumer of Identity/Access/Runtime's published contracts — no
 * ownership check, policy evaluation, or SHOULD/CAN/DID logic is
 * reimplemented here, per the backlog's explicit instruction.
 */
export async function evaluateAgentRisk(tenantId: string, agentId: string): Promise<RiskFinding[]> {
  const agent = await getAgent(tenantId, agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND");

  const [contract, comparison, ownershipIssues, policyEvaluations, identities, lifecycleEvents, did, eventsPage, weights] = await Promise.all([
    getAgentContract(agentId),
    compareShouldCanDid(tenantId, agentId),
    getOwnershipIssues(tenantId, agentId, agent.criticality),
    listPolicyEvaluations(tenantId, agentId),
    listAgentIdentities(tenantId, agentId),
    listLifecycleEvents(tenantId, agentId),
    getDid(tenantId, agentId),
    listRuntimeEvents(tenantId, { agentId, limit: 200 }),
    getSeverityWeights(tenantId),
  ]);

  const approvedApplications = contract?.approvedApplications ?? [];
  const approvedAppsLower = new Set(approvedApplications.map((a) => a.toLowerCase()));
  const prohibitedActions = new Set((contract?.prohibitedActions ?? []).map((a) => a.toLowerCase()));
  const approvedActions = new Set((contract?.approvedActions ?? []).map((a) => a.toLowerCase()));
  const prohibitedData = contract?.prohibitedData ?? [];

  const triggers: Trigger[] = [];

  // excessive_access — compareShouldCanDid() already computed this.
  const excessiveOutcomes = comparison.outcomes.filter((o) => o.type === "excessive_access");
  if (excessiveOutcomes.length > 0) {
    triggers.push({
      category: "excessive_access",
      title: `${agent.agentName} has effective access beyond its approved contract`,
      explanation: `${agent.agentName}'s active contract approves ${approvedApplications.join(", ") || "no applications"}. Effective access includes ${excessiveOutcomes
        .map((o) => `${o.evidence.application}: ${o.evidence.entitlementName}`)
        .join("; ")}, which is not covered by the approved contract.`,
      recommendation: `Remove the following entitlement(s) from ${agent.agentName}'s account(s): ${excessiveOutcomes.map((o) => o.evidence.entitlementName).join(", ")}.`,
      evidence: excessiveOutcomes.map((o) => ({
        evidenceType: "access_grant",
        referenceId: String(o.evidence.grantId),
        summary: `${o.evidence.application}: ${o.evidence.entitlementName} (${o.evidence.dataClassification ?? "unclassified"})`,
      })),
    });
  }

  // unauthorized_resource — DID touched an application never in approved_applications.
  const unauthorizedResourceTuples = did.tuples.filter((t) => t.application && !approvedAppsLower.has(t.application.toLowerCase()));
  if (unauthorizedResourceTuples.length > 0) {
    triggers.push({
      category: "unauthorized_resource",
      title: `${agent.agentName} accessed an application outside its approved scope`,
      explanation: `${agent.agentName} was observed accessing ${unauthorizedResourceTuples
        .map((t) => `${t.application}${t.resource ? `/${t.resource}` : ""}`)
        .join(", ")}, which is not among the agent's approved applications (${approvedApplications.join(", ") || "none"}).`,
      recommendation: `Investigate this access and remove it if unintended.`,
      evidence: unauthorizedResourceTuples.map((t) => ({
        evidenceType: "runtime_event",
        referenceId: t.sampleEventId,
        summary: `${t.application}/${t.resource ?? "?"} ${t.action} (last seen ${t.lastSeenAt})`,
      })),
    });
  }

  // unauthorized_action — a prohibited action, or one absent from approved_actions when that list is non-empty.
  const unauthorizedActionTuples = did.tuples.filter((t) => {
    const action = t.action.toLowerCase();
    if (prohibitedActions.has(action)) return true;
    return approvedActions.size > 0 && !approvedActions.has(action);
  });
  if (unauthorizedActionTuples.length > 0) {
    triggers.push({
      category: "unauthorized_action",
      title: `${agent.agentName} performed an action outside its approved purpose`,
      explanation: `${agent.agentName} performed ${[...new Set(unauthorizedActionTuples.map((t) => t.action))].join(", ")}, which is either explicitly prohibited or absent from the agent's approved actions (${[...approvedActions].join(", ") || "none"}).`,
      recommendation: `Confirm whether this action is intended; if not, restrict the agent's contract or remove the underlying capability.`,
      evidence: unauthorizedActionTuples.map((t) => ({
        evidenceType: "runtime_event",
        referenceId: t.sampleEventId,
        summary: `${t.application ?? "?"}/${t.resource ?? "?"} ${t.action} (last seen ${t.lastSeenAt})`,
      })),
    });
  }

  // sensitive_data_violation — DID or CAN touches a prohibited data classification.
  const sensitiveDidTuples = did.tuples.filter((t) => t.dataClassification && prohibitedData.some((p) => classificationsCompatible(p, t.dataClassification!)));
  const sensitiveCanEntries = comparison.can.filter((c) => c.dataClassification && prohibitedData.some((p) => classificationsCompatible(p, c.dataClassification!)));
  const isProhibitedDataViolation = sensitiveDidTuples.length > 0 || sensitiveCanEntries.length > 0;
  if (isProhibitedDataViolation) {
    triggers.push({
      category: "sensitive_data_violation",
      title: `${agent.agentName} accessed data outside its approved classification`,
      explanation: `${agent.agentName}'s contract prohibits access to ${prohibitedData.join(", ")}. ${sensitiveDidTuples
        .map((t) => `On ${t.lastSeenAt}, the agent read ${t.dataClassification}-classified data (${t.application ?? "?"}${t.resource ? ` → ${t.resource}` : ""}) via ${t.action}.`)
        .join(" ")}`.trim(),
      recommendation: `Remove the entitlement(s) granting access to prohibited data classifications and confirm no further access occurs.`,
      isProhibitedDataViolation: true,
      evidence: [
        ...sensitiveDidTuples.map((t) => ({
          evidenceType: "runtime_event" as const,
          referenceId: t.sampleEventId,
          summary: `${t.application ?? "?"}/${t.resource ?? "?"} ${t.action} (${t.dataClassification})`,
        })),
        ...sensitiveCanEntries.map((c) => ({
          evidenceType: "access_grant" as const,
          referenceId: c.grantId,
          summary: `${c.application}: ${c.entitlementName} (${c.dataClassification})`,
        })),
      ],
    });
  }

  // behavioral_deviation — SHOULD != DID, not already captured as unauthorized_resource above.
  const alreadyCapturedApps = new Set(unauthorizedResourceTuples.map((t) => t.application));
  const remainingBehavioral = comparison.outcomes.filter(
    (o) => o.type === "behavioral_violation" && !alreadyCapturedApps.has((o.evidence.application as string | null | undefined) ?? null),
  );
  if (remainingBehavioral.length > 0) {
    triggers.push({
      category: "behavioral_deviation",
      title: `${agent.agentName}'s observed behavior deviates from its approved purpose`,
      explanation: `${agent.agentName}'s runtime activity does not match its approved contract in a way not already captured as unauthorized-resource access: ${remainingBehavioral
        .map((o) => `${o.evidence.application ?? "?"}${o.evidence.resource ? `/${o.evidence.resource}` : ""}`)
        .join(", ")}.`,
      recommendation: `Review the agent's recent activity against its approved purpose and adjust the contract or access as needed.`,
      evidence: remainingBehavioral.map((o) => ({
        evidenceType: "runtime_event",
        referenceId: String(o.evidence.eventId),
        summary: `${o.evidence.application ?? "?"}/${o.evidence.resource ?? "?"}`,
      })),
    });
  }

  // identity_anomaly — event identity_id unknown, or known but removed.
  const identityById = new Map(identities.map((i) => [i.id, i]));
  const anomalousEvents = eventsPage.events.filter((e) => e.identityId && (!identityById.has(e.identityId) || identityById.get(e.identityId)!.status === "removed"));
  if (anomalousEvents.length > 0) {
    triggers.push({
      category: "identity_anomaly",
      title: `${agent.agentName} generated runtime activity from an unrecognized or removed identity`,
      explanation: `${anomalousEvents.length} runtime event(s) reference an identity that is not on file for ${agent.agentName}, or that has been marked removed.`,
      recommendation: `Investigate the source of this activity — it may indicate a compromised credential or an unregistered identity acting as this agent.`,
      evidence: anomalousEvents.map((e) => ({
        evidenceType: "runtime_event",
        referenceId: e.id,
        summary: `identity_id=${e.identityId} at ${e.eventTime}`,
      })),
    });
  }

  // ownership_violation
  if (ownershipIssues.length > 0) {
    triggers.push({
      category: "ownership_violation",
      title: `${agent.agentName} has an ownership gap`,
      explanation: `Identity Agent reports ${ownershipIssues.length} ownership issue(s) for ${agent.agentName}: ${ownershipIssues.map((i) => i.type).join(", ")}.`,
      recommendation: `Assign the missing/valid owner(s) before this agent's next certification.`,
      evidence: ownershipIssues.map((issue, i) => ({
        evidenceType: "ownership_fact",
        referenceId: agent.id,
        summary: `${JSON.stringify(issue)} (#${i})`,
      })),
    });
  }

  // lifecycle_violation — activity observed after a SUSPENDED/RETIRED transition.
  if (agent.lifecycleState === "SUSPENDED" || agent.lifecycleState === "RETIRED") {
    const terminalTransition = [...lifecycleEvents].reverse().find((e) => e.toState === agent.lifecycleState);
    if (terminalTransition) {
      const eventsAfterTransition = eventsPage.events.filter((e) => e.eventTime > terminalTransition.createdAt);
      if (eventsAfterTransition.length > 0) {
        triggers.push({
          category: "lifecycle_violation",
          title: `${agent.agentName} was active after being ${agent.lifecycleState.toLowerCase()}`,
          explanation: `${agent.agentName} transitioned to ${agent.lifecycleState} on ${terminalTransition.createdAt}, but ${eventsAfterTransition.length} runtime event(s) occurred after that.`,
          recommendation: `Confirm the agent's credentials/access were actually revoked at the point of ${agent.lifecycleState.toLowerCase()}.`,
          evidence: eventsAfterTransition.map((e) => ({
            evidenceType: "lifecycle_event",
            referenceId: e.id,
            summary: `${e.application ?? "?"}/${e.resource ?? "?"} ${e.action} at ${e.eventTime}`,
          })),
        });
      }
    }
  }

  const sensitiveInvolved = did.tuples.some((t) => isSensitiveClassification(t.dataClassification)) || comparison.can.some((c) => isSensitiveClassification(c.dataClassification));
  const behavioralOrIdentityAnomalyPresent = remainingBehavioral.length > 0 || anomalousEvents.length > 0;

  // RISK-P0-02.2 — weights come from this tenant's configured overrides
  // (falling back to the deterministic defaults), never hard-coded
  // literals, so an admin can tune scoring without a code change.
  const w = (name: string) => resolveWeight(name, weights);
  const factors: RiskFactor[] = [
    { name: "Production environment access", weight: w("Production environment access"), triggered: agent.environment === "production" && comparison.can.length > 0 },
    { name: "Sensitive data (PII/financial/confidential) involved", weight: w("Sensitive data (PII/financial/confidential) involved"), triggered: sensitiveInvolved },
    { name: "External communication capability", weight: w("External communication capability"), triggered: false }, // not modeled by any module yet
    { name: "Certification overdue", weight: w("Certification overdue"), triggered: false }, // Compliance Agent doesn't exist yet
    { name: "Active policy violation", weight: w("Active policy violation"), triggered: policyEvaluations.some((e) => e.result === "violation") },
    { name: "Runtime/behavioral anomaly present", weight: w("Runtime/behavioral anomaly present"), triggered: behavioralOrIdentityAnomalyPresent },
    { name: "Business criticality high/critical", weight: w("Business criticality high/critical"), triggered: agent.criticality === "high" || agent.criticality === "critical" },
    { name: "Missing or invalid ownership", weight: w("Missing or invalid ownership"), triggered: ownershipIssues.length > 0 },
  ];
  const base = computeSeverity(factors);

  const results: RiskFinding[] = [];
  let anyCritical = false;

  for (const trigger of triggers) {
    const { severity, reasons } = applyProhibitedDataOverride(base.severity, base.reasons, Boolean(trigger.isProhibitedDataViolation));
    const { finding } = await createOrUpdateFinding(
      tenantId,
      agentId,
      trigger.category,
      {
        severity,
        riskScore: base.riskScore,
        reasons,
        title: trigger.title,
        explanation: trigger.explanation,
        recommendation: trigger.recommendation,
        evaluatorVersion: EVALUATOR_VERSION,
      },
      trigger.evidence,
    );
    results.push(finding);
    if (severity === "critical") anyCritical = true;
  }

  // Dependencies section: "transitionAgentLifecycle (Risk calls this to
  // move an agent to RESTRICTED on a CRITICAL finding, per Identity's
  // transition table)". Best-effort and non-fatal: an agent not currently
  // ACTIVE, or already RESTRICTED, simply can't make this transition
  // (isStructurallyAllowedTransition already rules that out) — that is not
  // a reason to fail the whole risk evaluation.
  if (anyCritical && agent.lifecycleState === "ACTIVE") {
    try {
      await transitionAgentLifecycle(tenantId, agentId, "RESTRICTED", "Automatically restricted: a CRITICAL risk finding was recorded.", {
        actorType: "system",
      });
    } catch (err) {
      await writeAudit({
        tenantId,
        actorId: null,
        actorType: "system",
        action: "risk.auto_restrict_failed",
        objectType: "agent",
        objectId: agentId,
        outcome: "failure",
        metadata: { reason: err instanceof Error ? err.message : "unknown error" },
      });
    }
  }

  return results;
}
