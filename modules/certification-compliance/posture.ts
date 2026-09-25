import "server-only";

import { getAgent, getAgentContract, listAgentIdentities, getOwnershipIssues } from "@/modules/agent-identity/service";
import {
  compareAccessToContract,
  classifyActionsForAgent,
  listPolicyEvaluations,
  listGovernanceExceptions,
} from "@/modules/access-governance/service";
import { getDid } from "@/modules/runtime-assurance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { GovernanceDimensionResult, GovernancePosture, GovernancePostureStatus } from "@/lib/shared/types/compliance";
import type { PolicyEvaluationResult } from "@/lib/shared/types/access-governance";
import { getCertificationHistory } from "./decisions";
import { listControlFrameworks, listControls, listControlMappings } from "./controls";

const CORE_DIMENSIONS = new Set(["identity", "ownership", "purpose", "lifecycle"]);
const GOVERNED_LIFECYCLE_STATES = new Set(["APPROVED", "PROVISIONED", "ACTIVE", "CERTIFICATION_DUE"]);

function na(dimension: GovernanceDimensionResult["dimension"], reason: string): GovernanceDimensionResult {
  return { dimension, status: "not_applicable", reason };
}

/**
 * COMPLIANCE-P0-07 — Governance Posture. A read-model computed from every
 * relevant module's already-published contract (Identity's agent/contract/
 * owner/identity facts, Access's SHOULD-vs-CAN comparison/action
 * governance/policy evaluations/governance exceptions, Runtime's DID,
 * this module's own certification history and control mappings). No new
 * table, no cross-module table reads (non-negotiable #6), deterministic
 * (non-negotiable #9) — every dimension carries an explicit reason, never
 * a single opaque number.
 *
 * Deliberately excluded from the requirements doc's named dimension list:
 * none — all twelve (Identity/Ownership/Purpose/Access/Action authority/
 * Certification/Runtime monitoring/Human oversight/Policy compliance/
 * Lifecycle/Compliance controls/Evidence completeness) are covered below.
 */
export async function getGovernancePosture(tenantId: string, agentId: string): Promise<GovernancePosture> {
  const agent = await getAgent(tenantId, agentId);
  if (!agent) throw new ApiError(404, "NOT_FOUND", "Agent not found");

  const contract = await getAgentContract(agentId, tenantId);
  const dimensions: GovernanceDimensionResult[] = [];

  // 1. Identity
  const identities = await listAgentIdentities(tenantId, agentId);
  const activeIdentities = identities.filter(
    (i) => i.status === "active" && (i.confidence === "confirmed" || i.confidence === "probable"),
  );
  dimensions.push(
    activeIdentities.length > 0
      ? { dimension: "identity", status: "governed", reason: `${activeIdentities.length} confirmed/probable active IAM identity link(s)` }
      : { dimension: "identity", status: "gap", reason: "No confirmed or probable active IAM identity linked" },
  );

  // 2. Ownership
  const ownershipIssues = await getOwnershipIssues(tenantId, agentId, agent.criticality);
  dimensions.push(
    ownershipIssues.length === 0
      ? { dimension: "ownership", status: "governed", reason: "No open ownership issues" }
      : { dimension: "ownership", status: "gap", reason: `${ownershipIssues.length} ownership issue(s): ${ownershipIssues.map((i) => i.type).join(", ")}` },
  );

  // 3. Purpose
  dimensions.push(
    contract && contract.purpose.trim().length > 0
      ? { dimension: "purpose", status: "governed", reason: "Active contract defines an approved purpose" }
      : { dimension: "purpose", status: "gap", reason: "No active contract with a defined purpose" },
  );

  // 4. Lifecycle
  if (agent.lifecycleState === "SUSPENDED" || agent.lifecycleState === "RETIRED") {
    dimensions.push({ dimension: "lifecycle", status: "gap", reason: `Agent lifecycle state is ${agent.lifecycleState}` });
  } else if (GOVERNED_LIFECYCLE_STATES.has(agent.lifecycleState)) {
    dimensions.push({ dimension: "lifecycle", status: "governed", reason: `Lifecycle state ${agent.lifecycleState} is a governed state` });
  } else {
    dimensions.push({ dimension: "lifecycle", status: "gap", reason: `Lifecycle state ${agent.lifecycleState} is pre-approval — not yet governed` });
  }

  if (!contract) {
    // Every remaining dimension needs an active contract to evaluate against.
    dimensions.push(na("access", "No active contract to compare effective access against"));
    dimensions.push(na("action_authority", "No active contract to classify actions against"));
    dimensions.push(na("runtime_monitoring", "No active contract to read a required-monitoring declaration from"));
    dimensions.push(na("human_oversight", "No active contract to read an autonomy level from"));
    dimensions.push(na("policy_compliance", "No active contract to evaluate policies against"));
    dimensions.push(na("compliance_controls", "No active contract to read required compliance controls from"));
  } else {
    // 5. Access (SHOULD vs CAN)
    const comparisonRows = await compareAccessToContract(tenantId, agentId);
    const excessive = comparisonRows.filter((r) => r.classification === "excessive");
    dimensions.push(
      excessive.length === 0
        ? { dimension: "access", status: "governed", reason: "No excessive access relative to the approved contract" }
        : { dimension: "access", status: "gap", reason: `${excessive.length} excessive access grant(s) beyond the approved contract` },
    );

    // Runtime activity, shared by action_authority and runtime_monitoring.
    const did = await getDid(tenantId, agentId);
    const observedActions = [...new Set(did.tuples.map((t) => t.action))];
    const totalObservedEvents = did.tuples.reduce((sum, t) => sum + t.eventCount, 0);

    // 6. Action authority
    if (observedActions.length === 0) {
      dimensions.push(na("action_authority", "No observed runtime actions to classify yet"));
    } else {
      const classified = await classifyActionsForAgent(tenantId, agentId, observedActions);
      const disallowed = classified.filter((c) => c.state === "prohibited" || c.state === "restricted");
      dimensions.push(
        disallowed.length === 0
          ? { dimension: "action_authority", status: "governed", reason: "All observed actions are within the contract's action authority" }
          : {
              dimension: "action_authority",
              status: "gap",
              reason: `${disallowed.length} observed action(s) outside the contract's action authority: ${disallowed.map((d) => `${d.action} (${d.state})`).join(", ")}`,
            },
      );
    }

    // 7. Runtime monitoring
    if (!contract.requiredMonitoring) {
      dimensions.push(na("runtime_monitoring", "Contract declares no required monitoring"));
    } else {
      dimensions.push(
        totalObservedEvents > 0
          ? { dimension: "runtime_monitoring", status: "governed", reason: `Required monitoring "${contract.requiredMonitoring}" is receiving runtime activity` }
          : {
              dimension: "runtime_monitoring",
              status: "gap",
              reason: `Required monitoring "${contract.requiredMonitoring}" is configured but no runtime activity has been observed`,
            },
      );
    }

    // 8. Human oversight
    if (contract.autonomyLevel >= 3 && contract.actionsRequiringApproval.length === 0) {
      dimensions.push({
        dimension: "human_oversight",
        status: "gap",
        reason: `Autonomy level ${contract.autonomyLevel} (high autonomy) with no actions requiring approval defined`,
      });
    } else {
      dimensions.push({ dimension: "human_oversight", status: "governed", reason: `Autonomy level ${contract.autonomyLevel} matches its declared approval requirements` });
    }

    // 9. Policy compliance
    const evaluations = await listPolicyEvaluations(tenantId, agentId);
    const latestByPolicy = new Map<string, PolicyEvaluationResult>();
    for (const e of evaluations) if (!latestByPolicy.has(e.policyId)) latestByPolicy.set(e.policyId, e);
    const violations = [...latestByPolicy.values()].filter((e) => e.result === "violation");
    if (latestByPolicy.size === 0) {
      dimensions.push(na("policy_compliance", "No policy evaluations recorded yet"));
    } else {
      dimensions.push(
        violations.length === 0
          ? { dimension: "policy_compliance", status: "governed", reason: "No open policy violations in the latest evaluation of each policy" }
          : { dimension: "policy_compliance", status: "gap", reason: `${violations.length} policy(ies) currently evaluated as a violation` },
      );
    }

    // 10. Compliance controls
    if (contract.requiredComplianceControls.length === 0) {
      dimensions.push(na("compliance_controls", "No required compliance controls declared on the contract"));
    } else {
      const frameworks = await listControlFrameworks();
      const allControls = (await Promise.all(frameworks.map((f) => listControls(f.id)))).flat();
      const controlsByRef = new Map(allControls.map((c) => [c.controlRef, c]));
      const mappings = await listControlMappings(tenantId);
      const mappingByControlId = new Map(mappings.map((m) => [m.controlId, m]));
      const gaps: string[] = [];
      for (const ref of contract.requiredComplianceControls) {
        const control = controlsByRef.get(ref);
        const mapping = control ? mappingByControlId.get(control.id) : undefined;
        if (!mapping || (mapping.status !== "compliant" && mapping.status !== "not_applicable")) gaps.push(ref);
      }
      dimensions.push(
        gaps.length === 0
          ? { dimension: "compliance_controls", status: "governed", reason: "All required compliance controls are mapped and compliant" }
          : { dimension: "compliance_controls", status: "gap", reason: `Required control(s) not compliant or unmapped: ${gaps.join(", ")}` },
      );
    }
  }

  // 11. Certification (independent of contract presence)
  const certificationHistory = await getCertificationHistory(tenantId, agentId);
  if (agent.lifecycleState === "CERTIFICATION_DUE") {
    dimensions.push({ dimension: "certification", status: "gap", reason: "Certification is overdue" });
  } else if (certificationHistory.length === 0) {
    dimensions.push({ dimension: "certification", status: "gap", reason: "Agent has never completed a certification decision" });
  } else {
    dimensions.push({ dimension: "certification", status: "governed", reason: `Last certified ${certificationHistory[0].decidedAt}` });
  }

  // 12. Evidence completeness
  const hasSnapshotEvidence = certificationHistory.some((d) => d.snapshot !== null);
  dimensions.push(
    certificationHistory.length > 0 && hasSnapshotEvidence
      ? { dimension: "evidence_completeness", status: "governed", reason: "At least one certification decision has a captured evidence snapshot" }
      : { dimension: "evidence_completeness", status: "gap", reason: "No certification decision with a captured evidence snapshot yet" },
  );

  const gaps = dimensions.filter((d) => d.status === "gap");
  const activeExceptions = (await listGovernanceExceptions(tenantId, { agentId })).filter((e) => e.status === "active");

  let status: GovernancePostureStatus;
  if (agent.lifecycleState === "SUSPENDED") {
    status = "SUSPENDED";
  } else if (gaps.length === 0) {
    status = "GOVERNED";
  } else if (activeExceptions.length > 0) {
    status = "EXCEPTION_APPROVED";
  } else if (gaps.some((g) => CORE_DIMENSIONS.has(g.dimension))) {
    status = "NON_COMPLIANT";
  } else {
    status = "PARTIALLY_GOVERNED";
  }

  return {
    agentId,
    tenantId,
    status,
    computedAt: new Date().toISOString(),
    dimensions,
    coveringExceptionIds: status === "EXCEPTION_APPROVED" ? activeExceptions.map((e) => e.id) : [],
  };
}
