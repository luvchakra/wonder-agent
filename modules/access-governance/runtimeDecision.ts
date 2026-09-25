import type {
  PolicyAction,
  PolicyRule,
  RuntimeDecision,
  RuntimeDecisionOutcome,
  RuntimeDecisionStep,
  RuntimeRequest,
  RuntimeRestrictions,
} from "@/lib/shared/types/access-governance";
import { classifyAction } from "./actionGovernance";
import { evaluateCondition } from "./conditions";

/**
 * ACCESS-P0-11 — the deterministic runtime decision (master stories
 * P0-28 to P0-32). A pure function over facts the loader
 * (`evaluateRuntimeRequest()`, runtimeDecisionLoader.ts) has already
 * gathered, so every branch is unit-testable without a database, and no
 * model is ever consulted (non-negotiable #9).
 *
 * The master evaluation order is tenant → identity → lifecycle → emergency
 * controls → approved access (SHOULD) → effective access (CAN) → context →
 * risk → runtime policy. Every step is recorded. The final decision is the
 * most restrictive any step raised: DENY > REQUIRE_APPROVAL >
 * ALLOW_WITH_RESTRICTIONS > ALLOW.
 *
 * Fail-safe (§17.4, master §21): an unknown agent or resource, a suspended
 * agent, an explicit prohibition, or a fact the loader could not establish
 * never becomes permission. Unknown means DENY, or REQUIRE_APPROVAL where a
 * human can safely decide.
 */

export type RuntimeContractFacts = {
  approvedApplications: string[];
  approvedData: string[];
  prohibitedData: string[];
  approvedActions: string[];
  prohibitedActions: string[];
  actionsRequiringApproval: string[];
  allowedTools: string[];
  autonomyLevel: number;
  maximumRisk: "low" | "medium" | "high";
};

export type RuntimePolicyFacts = {
  id: string;
  version: number;
  name: string;
  action: PolicyAction;
  rules: Pick<PolicyRule, "id" | "condition">[];
};

export type RuntimeDecisionFacts = {
  request: RuntimeRequest;
  /** Established by the gateway from the verified key: the key's tenant is active. */
  tenantActive: boolean;
  agent: null | {
    id: string;
    lifecycleState: string;
    environment: string;
    criticality: string;
    riskScore: number | null;
  };
  /** null when no identityId was supplied; otherwise whether it belongs to this agent. */
  identityBelongsToAgent: boolean | null;
  contract: RuntimeContractFacts | null;
  /** Application names the agent can technically reach (CAN), or null if that could not be established. */
  effectiveApplications: string[] | null;
  emergency: { killSwitch: boolean; suspendedTools: string[] };
  runtimePolicies: RuntimePolicyFacts[];
};

const SEVERITY: Record<RuntimeDecisionOutcome, number> = {
  ALLOW: 0,
  ALLOW_WITH_RESTRICTIONS: 1,
  REQUIRE_APPROVAL: 2,
  DENY: 3,
};

/** Lifecycle states in which an agent may act at all. RESTRICTED may only read. */
const OPERATING_STATES = new Set(["ACTIVE", "CERTIFICATION_DUE", "RESTRICTED"]);

/** Verbs that change state. Risk and RESTRICTED rules only bite on these. */
// The verb must end at a separator or the end: tool names are usually
// snake_case (`delete_customer`), and `\b` treats `_` as a word character.
const MUTATING = /^(create|update|delete|remove|write|drop|insert|modify|refund|transfer|pay|export|send|post|put|patch|grant|revoke|approve|execute|run|deploy)(?=$|[\s_.:/-])/i;

const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

function norm(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function inList(list: string[], value: string | undefined): boolean {
  const needle = norm(value);
  return needle !== "" && list.some((item) => norm(item) === needle);
}

export function isMutatingAction(action: string): boolean {
  return MUTATING.test(action.trim());
}

function riskBand(score: number): keyof typeof RISK_RANK {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function decideRuntimeRequest(facts: RuntimeDecisionFacts): RuntimeDecision {
  const { request, agent, contract } = facts;
  const steps: RuntimeDecisionStep[] = [];
  const restrictions: RuntimeRestrictions = {};
  let policyHit: { id: string; version: number } | undefined;

  const step = (s: RuntimeDecisionStep) => steps.push(s);
  const pass = (name: RuntimeDecisionStep["step"], code: string, reason: string) =>
    step({ step: name, outcome: "PASS", code, reason });
  const skip = (name: RuntimeDecisionStep["step"], reason: string) =>
    step({ step: name, outcome: "SKIPPED", code: "SKIPPED", reason });

  // 1. Tenant.
  if (!facts.tenantActive) {
    step({ step: "tenant", outcome: "DENY", code: "TENANT_INACTIVE", reason: "The organization is not active." });
  } else {
    pass("tenant", "TENANT_ACTIVE", "Organization is active.");
  }

  // 2. Identity: the agent must exist (in the key's tenant), and a named
  //    identity must be one of that agent's own.
  if (!agent) {
    step({ step: "identity", outcome: "DENY", code: "UNKNOWN_AGENT", reason: "The agent is not known in this organization." });
  } else if (facts.identityBelongsToAgent === false) {
    step({ step: "identity", outcome: "DENY", code: "UNKNOWN_IDENTITY", reason: "The acting identity is not linked to this agent." });
  } else {
    pass("identity", "IDENTITY_VERIFIED", "Agent authenticated by its API key.");
  }

  const fatal = !facts.tenantActive || !agent;
  const mutating = isMutatingAction(request.action);

  // 3. Lifecycle.
  if (fatal || !agent) {
    skip("lifecycle", "No verified agent.");
  } else if (!OPERATING_STATES.has(agent.lifecycleState)) {
    step({
      step: "lifecycle",
      outcome: "DENY",
      code: "AGENT_NOT_OPERATING",
      reason: `An agent in lifecycle state ${agent.lifecycleState} may not act.`,
    });
  } else if (agent.lifecycleState === "RESTRICTED") {
    if (mutating) {
      step({ step: "lifecycle", outcome: "DENY", code: "AGENT_RESTRICTED", reason: "A restricted agent may only read." });
    } else {
      restrictions.readOnly = true;
      step({ step: "lifecycle", outcome: "ALLOW_WITH_RESTRICTIONS", code: "AGENT_RESTRICTED", reason: "A restricted agent may only read." });
    }
  } else {
    pass("lifecycle", "AGENT_OPERATING", `Lifecycle state ${agent.lifecycleState}.`);
  }

  // 4. Emergency controls.
  if (facts.emergency.killSwitch) {
    step({ step: "emergency", outcome: "DENY", code: "KILL_SWITCH", reason: "The emergency kill switch is engaged." });
  } else if (request.tool && inList(facts.emergency.suspendedTools, request.tool)) {
    step({ step: "emergency", outcome: "DENY", code: "TOOL_SUSPENDED", reason: `Tool ${request.tool} is suspended.` });
  } else {
    pass("emergency", "NO_EMERGENCY_CONTROL", "No emergency control applies.");
  }

  // 5. Approved access (SHOULD).
  if (fatal) {
    skip("approved_access", "No verified agent.");
  } else if (!contract) {
    step({
      step: "approved_access",
      outcome: "DENY",
      code: "NO_ACTIVE_CONTRACT",
      reason: "The agent has no active contract, so nothing is approved.",
    });
  } else {
    const actionState = classifyAction(contract, request.action);
    if (actionState === "prohibited") {
      step({ step: "approved_access", outcome: "DENY", code: "ACTION_PROHIBITED", reason: `Action ${request.action} is prohibited by the contract.` });
    } else if (request.dataClassification && inList(contract.prohibitedData, request.dataClassification)) {
      step({ step: "approved_access", outcome: "DENY", code: "DATA_PROHIBITED", reason: `${request.dataClassification} data is prohibited by the contract.` });
    } else if (contract.autonomyLevel === 0) {
      step({ step: "approved_access", outcome: "DENY", code: "AUTONOMY_HUMAN_ONLY", reason: "Autonomy level 0: a human performs this agent's actions." });
    } else if (request.application && contract.approvedApplications.length > 0 && !inList(contract.approvedApplications, request.application)) {
      step({ step: "approved_access", outcome: "DENY", code: "APPLICATION_NOT_APPROVED", reason: `Application ${request.application} is not approved.` });
    } else if (request.tool && contract.allowedTools.length > 0 && !inList(contract.allowedTools, request.tool)) {
      step({ step: "approved_access", outcome: "DENY", code: "TOOL_NOT_APPROVED", reason: `Tool ${request.tool} is not approved.` });
    } else if (request.dataClassification && contract.approvedData.length > 0 && !inList(contract.approvedData, request.dataClassification)) {
      step({ step: "approved_access", outcome: "DENY", code: "DATA_NOT_APPROVED", reason: `${request.dataClassification} data is not approved.` });
    } else if (actionState === "restricted") {
      // Not named anywhere in the contract: never silently allowed.
      step({ step: "approved_access", outcome: "DENY", code: "ACTION_NOT_APPROVED", reason: `Action ${request.action} is not approved by the contract.` });
    } else if (actionState === "allowed_with_approval") {
      step({ step: "approved_access", outcome: "REQUIRE_APPROVAL", code: "ACTION_REQUIRES_APPROVAL", reason: `Action ${request.action} requires human approval.` });
    } else if (contract.autonomyLevel <= 2) {
      step({
        step: "approved_access",
        outcome: "REQUIRE_APPROVAL",
        code: "AUTONOMY_REQUIRES_APPROVAL",
        reason: `Autonomy level ${contract.autonomyLevel}: the agent acts only with human approval.`,
      });
    } else {
      pass("approved_access", "APPROVED", `Action ${request.action} is approved.`);
    }
  }

  // 6. Effective access (CAN): the agent must technically hold access to
  //    the application it is calling. The gateway never grants beyond IAM.
  if (fatal) {
    skip("effective_access", "No verified agent.");
  } else if (!request.application) {
    pass("effective_access", "NO_APPLICATION", "No application named; nothing to check against effective access.");
  } else if (facts.effectiveApplications === null) {
    step({
      step: "effective_access",
      outcome: "DENY",
      code: "EFFECTIVE_ACCESS_UNKNOWN",
      reason: "Effective access could not be established.",
    });
  } else if (!inList(facts.effectiveApplications, request.application)) {
    step({
      step: "effective_access",
      outcome: "DENY",
      code: "NO_EFFECTIVE_ACCESS",
      reason: `The agent holds no access to ${request.application} in the connected IAM data.`,
    });
  } else {
    pass("effective_access", "HAS_EFFECTIVE_ACCESS", `The agent holds access to ${request.application}.`);
  }

  // 7. Context.
  const env = request.context?.environment;
  if (fatal || !agent) {
    skip("context", "No verified agent.");
  } else if (env && norm(env) !== norm(agent.environment)) {
    step({
      step: "context",
      outcome: "DENY",
      code: "ENVIRONMENT_MISMATCH",
      reason: `Request is for ${env}, but the agent is registered for ${agent.environment}.`,
    });
  } else {
    pass("context", "CONTEXT_OK", "Context matches the agent's registration.");
  }

  // 8. Risk (master P0-31: e.g. high risk + destructive tool + production
  //    → REQUIRE_APPROVAL). Only state-changing actions are gated.
  if (fatal || !agent) {
    skip("risk", "No verified agent.");
  } else if (agent.riskScore === null) {
    pass("risk", "NOT_SCORED", "The agent has not been risk-scored yet.");
  } else {
    const band = riskBand(agent.riskScore);
    const production = norm(env ?? agent.environment) === "production";
    if (mutating && band === "critical") {
      step({ step: "risk", outcome: "REQUIRE_APPROVAL", code: "CRITICAL_RISK_MUTATION", reason: `Critical-risk agent (${Math.round(agent.riskScore)}) attempting a state change.` });
    } else if (mutating && band === "high" && production) {
      step({ step: "risk", outcome: "REQUIRE_APPROVAL", code: "HIGH_RISK_PRODUCTION_MUTATION", reason: `High-risk agent (${Math.round(agent.riskScore)}) changing state in production.` });
    } else if (contract && RISK_RANK[band] > RISK_RANK[contract.maximumRisk]) {
      step({
        step: "risk",
        outcome: "REQUIRE_APPROVAL",
        code: "ABOVE_CONTRACT_MAXIMUM_RISK",
        reason: `Risk ${band} exceeds the contract's maximum of ${contract.maximumRisk}.`,
      });
    } else {
      pass("risk", "RISK_WITHIN_LIMITS", `Risk ${band} is within limits.`);
    }
  }

  // 9. Runtime policies. A rule whose condition is true fires its policy.
  //    A blocking policy that cannot be evaluated (a needed fact is
  //    unknown) goes to review, never to allow.
  if (fatal || !agent) {
    skip("runtime_policy", "No verified agent.");
  } else {
    const policyFacts: Record<string, unknown> = {
      "request.action": norm(request.action),
      "request.application": request.application ? norm(request.application) : undefined,
      "request.resource": request.resource ? norm(request.resource) : undefined,
      "request.tool": request.tool ? norm(request.tool) : undefined,
      "request.data_classification": request.dataClassification ? norm(request.dataClassification) : undefined,
      "request.environment": norm(env ?? agent.environment),
      "request.mutating": mutating,
      "agent.lifecycle_state": agent.lifecycleState,
      "agent.criticality": agent.criticality,
      "agent.environment": agent.environment,
      "agent.risk_score": agent.riskScore ?? undefined,
    };
    let strongest: { outcome: RuntimeDecisionOutcome; policy: RuntimePolicyFacts; code: string; reason: string } | null = null;
    for (const policy of facts.runtimePolicies) {
      const results = policy.rules.map((r) => evaluateCondition(r.condition, policyFacts));
      let outcome: RuntimeDecisionOutcome | null = null;
      let code = "";
      let reason = "";
      if (results.some((r) => r === true)) {
        if (policy.action === "block") {
          outcome = "DENY";
          code = "POLICY_BLOCK";
          reason = `Blocked by policy “${policy.name}”.`;
        } else if (policy.action === "restrict") {
          // "Restrict" means read-only, as for a RESTRICTED agent: a
          // state-changing request under it cannot be honoured.
          outcome = mutating ? "DENY" : "ALLOW_WITH_RESTRICTIONS";
          code = mutating ? "POLICY_RESTRICT_READ_ONLY" : "POLICY_RESTRICT";
          reason = mutating
            ? `Policy “${policy.name}” allows this agent read-only access.`
            : `Restricted to read-only by policy “${policy.name}”.`;
        }
        // "flag" policies record a match but do not change the decision.
      } else if (policy.action === "block" && results.some((r) => r === undefined)) {
        outcome = "REQUIRE_APPROVAL";
        code = "POLICY_UNEVALUABLE";
        reason = `Policy “${policy.name}” could not be evaluated; routed to review.`;
      }
      if (outcome && (!strongest || SEVERITY[outcome] > SEVERITY[strongest.outcome])) {
        strongest = { outcome, policy, code, reason };
      }
    }
    if (strongest) {
      policyHit = { id: strongest.policy.id, version: strongest.policy.version };
      if (strongest.outcome === "ALLOW_WITH_RESTRICTIONS") restrictions.readOnly = true;
      step({ step: "runtime_policy", outcome: strongest.outcome, code: strongest.code, reason: strongest.reason });
    } else {
      pass("runtime_policy", "NO_POLICY_FIRED", facts.runtimePolicies.length ? "No runtime policy fired." : "No runtime policies are active.");
    }
  }

  // Decision: the most restrictive step wins; its first occurrence explains it.
  let decision: RuntimeDecisionOutcome = "ALLOW";
  let decisive: RuntimeDecisionStep | undefined;
  for (const s of steps) {
    if (s.outcome === "PASS" || s.outcome === "SKIPPED") continue;
    if (SEVERITY[s.outcome] > SEVERITY[decision]) {
      decision = s.outcome;
      decisive = s;
    }
  }

  const result: RuntimeDecision = {
    decision,
    code: decisive?.code ?? "ALLOWED",
    reason: decisive?.reason ?? "Approved by contract, held in effective access, and within risk and policy limits.",
    steps,
  };
  if (agent?.riskScore !== null && agent?.riskScore !== undefined) result.riskScore = agent.riskScore;
  if (policyHit && (decisive?.step === "runtime_policy")) {
    result.policyId = policyHit.id;
    result.policyVersion = policyHit.version;
  }
  if (decision === "ALLOW_WITH_RESTRICTIONS" && Object.keys(restrictions).length > 0) result.restrictions = restrictions;
  return result;
}
