import "server-only";

import { getAgent, getAgentContract, getOwnershipIssues, listAgentIdentities, listLifecycleEvents, listRelationships, transitionAgentLifecycle, updateAgentRiskScore } from "@/modules/agent-identity/service";
import { countOverdueCertificationItems } from "@/modules/certification-compliance/service";
import { getMcpInventory } from "@/modules/integrations/service";
import { listAgentApiKeys } from "@/lib/security/agentApiKeys";
import { credentialHealth, destructiveCapability, suspiciousDelegation, unapprovedToolUse } from "./signals";
import { getEffectiveAccess, listApplications, listPolicyEvaluations } from "@/modules/access-governance/service";
import { compareShouldCanDid, getDid, listRuntimeEvents } from "@/modules/runtime-assurance/service";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { EvidenceType, RiskFactor, RiskFinding, RogueCategory } from "@/lib/shared/types/risk";
import { applyProhibitedDataOverride, computeSeverity, resolveWeight } from "./scoring";
import { createOrUpdateFinding } from "./findings";
import { getSeverityWeights } from "./config";
import { detectGovernanceDrift } from "./governanceDrift";

const SENSITIVE_KEYWORDS = ["pii", "financial", "confidential"];

/**
 * RISK-P0-01.4 — bump this whenever the deterministic detection logic in
 * this file materially changes, so a finding's evidence pack can show
 * exactly which version of the rule produced it. Existing rows backfill to
 * 1 via the column default (migration 0044) rather than a separate data
 * migration, per the story's own documented allowance.
 */
export const EVALUATOR_VERSION = 2; // 2026-09-25, RISK-P0-12: new signals and three factors given real sources

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

  const [
    contract,
    comparison,
    ownershipIssues,
    policyEvaluations,
    identities,
    lifecycleEvents,
    did,
    eventsPage,
    weights,
    applications,
    effectiveAccess,
    relationships,
    overdueCertifications,
    apiKeys,
    mcpInventory,
  ] = await Promise.all([
    getAgentContract(agentId),
    compareShouldCanDid(tenantId, agentId),
    getOwnershipIssues(tenantId, agentId, agent.criticality),
    listPolicyEvaluations(tenantId, agentId),
    listAgentIdentities(tenantId, agentId),
    listLifecycleEvents(tenantId, agentId),
    getDid(tenantId, agentId),
    listRuntimeEvents(tenantId, { agentId, limit: 200 }),
    getSeverityWeights(tenantId),
    listApplications(tenantId),
    // RISK-P1-05 — already one of this module's own declared dependencies
    // (see this backlog's "Dependencies" section); fetched directly here
    // rather than reusing comparison.can because Runtime Agent's CanEntry
    // (lib/shared/types/runtime.ts) intentionally doesn't carry
    // privilegeLevel — reaching into Access Agent's own published contract
    // for it keeps this a same-module addition, not a cross-module type
    // change (non-negotiable #6/#14).
    getEffectiveAccess(tenantId, agentId),
    // RISK-P0-12 — each from its owning module's published contract.
    listRelationships(tenantId, agentId),
    countOverdueCertificationItems(tenantId, agentId),
    listAgentApiKeys(tenantId, agentId),
    getMcpInventory(tenantId),
  ]);
  // The agents this one delegates to, shares a credential with, or
  // orchestrates: their names and lifecycle states, in one parallel wave.
  const relatedIds = [...new Set(relationships.map((r) => r.relatedAgentId))];
  const relatedAgents = new Map(
    (await Promise.all(relatedIds.map((id) => getAgent(tenantId, id))))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => [a.id, { name: a.agentName, lifecycleState: a.lifecycleState }]),
  );
  const externalApplicationNames = new Set(applications.filter((a) => a.isExternal).map((a) => a.name.toLowerCase()));

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

  // RISK-P0-12 — suspicious delegation (Identity's relationships) and
  // unapproved tool use (Runtime's SHOULD-vs-DID tool comparison).
  const delegation = suspiciousDelegation(agent.agentName, relationships, relatedAgents);
  if (delegation) triggers.push(delegation);
  const unapprovedTools = comparison.outcomes.filter((o) => o.type === "unapproved_tool").map((o) => String(o.evidence.tool));
  const toolUse = unapprovedToolUse(agent.agentName, unapprovedTools, eventsPage.events, contract?.allowedTools ?? []);
  if (toolUse) triggers.push(toolUse);

  // governance_drift — RISK-P0-04, a separate cross-module diff signal,
  // not a duplicate of any category above (those compare current state
  // against the *current* contract; this compares current state against
  // the contract/ownership/access *as of the agent's last approval*).
  const drift = await detectGovernanceDrift(tenantId, agent, contract, identities, lifecycleEvents);
  if (drift) {
    triggers.push(drift);
  }

  const sensitiveInvolved = did.tuples.some((t) => isSensitiveClassification(t.dataClassification)) || comparison.can.some((c) => isSensitiveClassification(c.dataClassification));
  const behavioralOrIdentityAnomalyPresent = remainingBehavioral.length > 0 || anomalousEvents.length > 0;
  // RISK-P1-05 — a capability check (CAN), same shape as the sibling
  // "Production environment access"/"External communication capability"
  // factors, not a usage (DID) one: the agent holding elevated/admin
  // access is itself the exposure, independent of whether it has been
  // exercised yet.
  const hasElevatedOrAdminAccess = effectiveAccess.some((g) => g.privilegeLevel === "elevated" || g.privilegeLevel === "admin");
  const destructiveMcpTools = new Set(mcpInventory.flatMap((server) => server.tools.filter((t) => t.destructive && t.stillDeclared).map((t) => t.name.toLowerCase())));
  const destructive = destructiveCapability(effectiveAccess, destructiveMcpTools);
  const credentials = credentialHealth(apiKeys, new Date());

  // RISK-P0-02.2 — weights come from this tenant's configured overrides
  // (falling back to the deterministic defaults), never hard-coded
  // literals, so an admin can tune scoring without a code change.
  const w = (name: string) => resolveWeight(name, weights);
  const factors: RiskFactor[] = [
    { name: "Production environment access", weight: w("Production environment access"), triggered: agent.environment === "production" && comparison.can.length > 0 },
    { name: "Sensitive data (PII/financial/confidential) involved", weight: w("Sensitive data (PII/financial/confidential) involved"), triggered: sensitiveInvolved },
    {
      name: "External communication capability",
      weight: w("External communication capability"),
      // ACCESS-P0-02.2, resolved 2026-09-16: CAN (effective access), not
      // DID — a capability check, matching the sibling "Production
      // environment access" factor's own CAN-based shape, not an
      // actual-usage one.
      triggered: comparison.can.some((c) => externalApplicationNames.has(c.application.toLowerCase())),
    },
    // RISK-P0-12: Compliance's published count of this agent's certification items pending past due.
    { name: "Certification overdue", weight: w("Certification overdue"), triggered: overdueCertifications > 0 },
    { name: "Active policy violation", weight: w("Active policy violation"), triggered: policyEvaluations.some((e) => e.result === "violation") },
    { name: "Runtime/behavioral anomaly present", weight: w("Runtime/behavioral anomaly present"), triggered: behavioralOrIdentityAnomalyPresent },
    { name: "Business criticality high/critical", weight: w("Business criticality high/critical"), triggered: agent.criticality === "high" || agent.criticality === "critical" },
    { name: "Missing or invalid ownership", weight: w("Missing or invalid ownership"), triggered: ownershipIssues.length > 0 },
    // RISK-P1-05 — four additional deterministic factors from the master
    // requirements doc's "# 15. Risk Engine" section. Each gets its own
    // named weight in the same configurable-weight machinery as the eight
    // above (RISK-P0-02.2) — a tenant can retune or zero any of them via
    // setSeverityWeight() with no code change. Only "Privilege level" has
    // a real, already-published data source right now (Access Agent's
    // entitlements.privilege_level, via getEffectiveAccess() above); the
    // other three are wired with real names/weights but always
    // `triggered: false` until their own data source exists, same
    // documented pattern as "Certification overdue" above (not a silent
    // omission — a currently-0 factor that contributes nothing until a
    // dependency is resolved). This must never change an already-`Done`
    // scoring outcome (this story's own acceptance criterion) — verified
    // for the FinanceBot central scenario in rules.test.ts.
    { name: "Privilege level (elevated/admin access)", weight: w("Privilege level (elevated/admin access)"), triggered: hasElevatedOrAdminAccess },
    // Destructive capability: needs a destructive-verb flag on the
    // entitlement itself (delete/purge/overwrite), which Access Agent's
    // effective-access model doesn't expose yet — DID's own `action`
    // field records what was actually *done*, not what an entitlement
    // technically *allows*, and every other capability factor here is
    // deliberately CAN-based (see "External communication capability"
    // above), so DID's action isn't a substitute. Recording the
    // dependency here rather than inventing Access Agent's representation
    // of it, per this story's own acceptance note.
    // RISK-P0-12: now sourced. CAN-based like its siblings: an entitlement
    // whose name starts with a destructive verb, or an MCP tool permission
    // for a tool its server declares destructive (INTEGRATION-P0-06).
    { name: "Destructive capability present", weight: w("Destructive capability present"), triggered: destructive.present },
    // Credential status: needs credential/secret health (expiry, weak,
    // shared, rotation-overdue) for the AGENT's own runtime identity —
    // distinct from Integration Agent's connector credentials (which
    // authenticate WonderAgent's own connection to a source system, not
    // the monitored agent's). No such contract is published by Identity
    // Agent yet (AgentIdentityLink tracks confidence/status, not
    // credential hygiene).
    // RISK-P0-12: now sourced from the agent's own Runtime Gateway API keys
    // (FOUNDATION-P0-17): rotation overdue or key sprawl.
    { name: "Credential status unhealthy", weight: w("Credential status unhealthy"), triggered: credentials.unhealthy },
    // Attack path: needs the agent's position on a path to a higher-
    // value/blast-radius resource in the effective-access graph — a
    // graph-traversal contract Access Agent hasn't published (distinct
    // from RISK-P2-02's downstream-propagation modeling, per this
    // story's own note).
    { name: "Position on a high-value attack path", weight: w("Position on a high-value attack path"), triggered: false },
  ];
  const base = computeSeverity(factors);

  // RISK-P0-02.1 — persist the agent-level score computed above onto
  // agents.risk_score via Identity's published sink, regardless of
  // whether any category trigger actually fired this run (a clean agent
  // still has a real, evaluated score of e.g. 0 worth recording, not just
  // "unknown"). Previously this was computed and stored on every finding
  // but never rolled up onto the agent record itself.
  await updateAgentRiskScore(tenantId, agentId, base.riskScore);

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
