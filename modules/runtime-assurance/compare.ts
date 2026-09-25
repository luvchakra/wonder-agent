import "server-only";

import { getAgentContract } from "@/modules/agent-identity/service";
import { getEffectiveAccess, getEffectiveAccessAsOf } from "@/modules/access-governance/service";
import type { CanEntry, ComparisonOutcome, DidEntry, NowEntry, ShouldCanDidComparison, ShouldEntry } from "@/lib/shared/types/runtime";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { getDid } from "./did";

/** Distinct tools this agent was observed using (runtime_tools only records observed event types). */
async function loadDidTools(tenantId: string, agentId: string): Promise<string[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("runtime_tools").select("name").eq("tenant_id", tenantId).eq("agent_id", agentId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return [...new Set(((data ?? []) as Array<{ name: string }>).map((t) => t.name))].sort();
}

type DecisionStepRow = { step: string; outcome: string };

/** How a recorded decision stood against SHOULD and CAN, read from its own evaluated steps. */
export function nowFromDecision(row: {
  id: string;
  request_id: string;
  action: string;
  application: string | null;
  tool: string | null;
  decision: NowEntry["decision"];
  code: string;
  reason: string;
  enforced: boolean;
  created_at: string;
  steps: DecisionStepRow[] | null;
}): NowEntry {
  const step = (name: string) => (row.steps ?? []).find((s) => s.step === name)?.outcome;
  const approvedStep = step("approved_access");
  const effectiveStep = step("effective_access");
  return {
    decisionId: row.id,
    requestId: row.request_id,
    action: row.action,
    application: row.application,
    tool: row.tool,
    decision: row.decision,
    code: row.code,
    reason: row.reason,
    approved:
      approvedStep === "PASS"
        ? "approved"
        : approvedStep === "REQUIRE_APPROVAL"
          ? "requires_approval"
          : approvedStep === "DENY"
            ? "not_approved"
            : "not_evaluated",
    effective: effectiveStep === "PASS" ? "within" : effectiveStep === "DENY" ? "outside" : "not_evaluated",
    enforced: row.enforced,
    at: row.created_at,
  };
}

async function loadNow(tenantId: string, agentId: string): Promise<NowEntry | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("runtime_decisions")
    .select("id, request_id, action, application, tool, decision, code, reason, enforced, created_at, steps")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? nowFromDecision(data as Parameters<typeof nowFromDecision>[0]) : null;
}

function sameTool(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Two free-text vocabularies are being compared here: an Agent Contract's
 * `approved_data` (business language, e.g. "financial reporting") and an
 * entitlement's/event's `data_classification` (a shorter code, e.g.
 * "financial", "pii" — see the FinanceBot fixture in
 * tests/access/financebot-scenario-and-tenant-isolation.sql). The backlog's
 * own worked example in docs/plan/05-RUNTIME-AGENT-BACKLOG.md only
 * reproduces if these are treated as compatible when one contains the
 * other's words, not only on exact equality — a real ambiguity the backlog
 * doesn't resolve, flagged here rather than silently guessed. This case-
 * insensitive substring match is deliberately simple and deterministic
 * (non-negotiable #9 — no LLM, no fuzzy/statistical matching), and is
 * exercised by both this module's unit tests and the live central-scenario
 * proof. A future Compliance/Risk-owned data-classification taxonomy could
 * replace this with an exact lookup; until one exists, this is the
 * documented behavior.
 */
function classificationsCompatible(approvedData: string, classification: string): boolean {
  const a = approvedData.trim().toLowerCase();
  const b = classification.trim().toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function isCanCoveredByShould(should: ShouldEntry[], can: CanEntry): boolean {
  const approvedForApp = should.filter((s) => s.application === can.application);
  if (approvedForApp.length === 0) return false;
  if (!can.dataClassification) return true;
  return approvedForApp.some((s) => s.data !== null && classificationsCompatible(s.data, can.dataClassification!));
}

function isDidCoveredByShould(should: ShouldEntry[], did: DidEntry): boolean {
  if (!did.application) return false;
  const approvedForApp = should.filter((s) => s.application === did.application);
  if (approvedForApp.length === 0) return false;
  if (!did.dataClassification) return true;
  return approvedForApp.some((s) => s.data !== null && classificationsCompatible(s.data, did.dataClassification!));
}

function isDidCoveredByCan(can: CanEntry[], did: DidEntry): boolean {
  if (!did.application) return false;
  const matchingApp = can.filter((c) => c.application === did.application);
  if (matchingApp.length === 0) return false;
  if (!did.dataClassification) return true;
  return matchingApp.some((c) => c.dataClassification !== null && classificationsCompatible(c.dataClassification!, did.dataClassification!));
}

function isCanExercisedInDid(did: DidEntry[], can: CanEntry): boolean {
  const matchingApp = did.filter((d) => d.application === can.application);
  if (matchingApp.length === 0) return false;
  if (!can.dataClassification) return true;
  return matchingApp.some((d) => d.dataClassification !== null && classificationsCompatible(can.dataClassification!, d.dataClassification!));
}

/**
 * RUNTIME-P0-02.2 (higher bar). Pure read/compute over already-stored
 * evidence (agent_contracts via Identity, access_grants via Access,
 * runtime_events via this module) — calling it twice with no new data
 * produces byte-identical output, per the acceptance criterion. Every
 * outcome carries the specific row(s) that produced it.
 *
 * DO NOT IMPLEMENT (per the backlog): severity assignment, finding
 * creation, or notification — that is Risk Agent's job, consuming this
 * comparison as evidence.
 *
 * RUNTIME-P0-13. `asOf` resolves CAN as of that point in time instead of
 * "right now," via Access Agent's published `getEffectiveAccessAsOf()` —
 * closing the historical-accuracy gap this story's own backlog entry
 * flagged: re-scoring an old event against today's (possibly
 * already-revoked) entitlements can silently erase a genuine historical
 * `excessive_access` finding. Omitting `asOf` preserves the exact previous
 * behavior (current access), so every existing caller and test is
 * unaffected.
 */
export async function compareShouldCanDid(tenantId: string, agentId: string, asOf?: string): Promise<ShouldCanDidComparison> {
  const [contract, canGrants, did, didTools, now] = await Promise.all([
    getAgentContract(agentId),
    asOf ? getEffectiveAccessAsOf(tenantId, agentId, asOf) : getEffectiveAccess(tenantId, agentId),
    getDid(tenantId, agentId),
    loadDidTools(tenantId, agentId),
    // NOW is the current request; a historical comparison has none.
    asOf ? Promise.resolve(null) : loadNow(tenantId, agentId),
  ]);

  const should: ShouldEntry[] = contract
    ? contract.approvedApplications.flatMap((application): ShouldEntry[] =>
        contract.approvedData.length > 0
          ? contract.approvedData.map(
              (data): ShouldEntry => ({ application, data, actions: contract.approvedActions, tools: contract.allowedTools ?? [] }),
            )
          : [{ application, data: null, actions: contract.approvedActions, tools: contract.allowedTools ?? [] }],
      )
    : [];

  // RUNTIME-P0-12 — SHOULD is "unknown" (not well-formed), distinct from a
  // genuinely empty-but-valid contract, when there is no active contract at
  // all or its purpose is unset/blank. A caller must check this flag
  // explicitly rather than infer it from should.length === 0.
  const shouldUnknown = !contract || !contract.purpose || !contract.purpose.trim();

  const can: CanEntry[] = canGrants.map((g) => ({
    application: g.application ?? "",
    dataClassification: g.dataClassification ?? null,
    entitlementName: g.entitlementName,
    grantId: g.id,
  }));

  const didEntries: DidEntry[] = did.tuples.map((t) => ({
    application: t.application,
    resource: t.resource,
    dataClassification: t.dataClassification,
    eventId: t.sampleEventId,
  }));

  const outcomes: ComparisonOutcome[] = [];

  for (const c of can) {
    if (!isCanCoveredByShould(should, c)) {
      outcomes.push({
        type: "excessive_access",
        evidence: { grantId: c.grantId, application: c.application, entitlementName: c.entitlementName, dataClassification: c.dataClassification },
      });
    }
  }
  for (const s of should) {
    const covered = can.some((c) => c.application === s.application && (!s.data || !c.dataClassification || classificationsCompatible(s.data, c.dataClassification)));
    if (!covered) {
      outcomes.push({ type: "insufficient_access", evidence: { application: s.application, data: s.data } });
    }
  }
  for (const c of can) {
    if (!isCanExercisedInDid(didEntries, c)) {
      outcomes.push({
        type: "unused_capability",
        evidence: { grantId: c.grantId, application: c.application, entitlementName: c.entitlementName },
      });
    }
  }
  for (const d of didEntries) {
    // RUNTIME-P0-14 — a DID tuple with no resolvable application (unknown
    // resource) must never be silently scored as either a real violation
    // or as compliant; it gets its own distinct outcome instead of falling
    // into unexpected_capability/behavioral_violation below.
    if (d.application === null) {
      outcomes.push({
        type: "unscored_unknown",
        evidence: { eventId: d.eventId, resource: d.resource, dataClassification: d.dataClassification, reason: "unresolved_application" },
      });
      continue;
    }
    if (!isDidCoveredByCan(can, d)) {
      outcomes.push({
        type: "unexpected_capability",
        evidence: { eventId: d.eventId, application: d.application, resource: d.resource, dataClassification: d.dataClassification },
      });
    }
  }
  for (const d of didEntries) {
    if (d.application === null) continue; // already scored unscored_unknown above
    if (!isDidCoveredByShould(should, d)) {
      outcomes.push({
        type: "behavioral_violation",
        evidence: { eventId: d.eventId, application: d.application, resource: d.resource, dataClassification: d.dataClassification },
      });
    }
  }
  // RUNTIME-P0-17 — tools. An empty allowed-tools list means the contract
  // does not restrict tools (the same rule as the gateway's decision), so
  // only a non-empty list can make a used tool unapproved.
  const allowedTools = contract?.allowedTools ?? [];
  if (contract && allowedTools.length > 0) {
    for (const tool of didTools) {
      if (!allowedTools.some((t) => sameTool(t, tool))) {
        outcomes.push({ type: "unapproved_tool", evidence: { tool, allowedTools } });
      }
    }
  }

  if (
    !shouldUnknown &&
    outcomes.length === 0 &&
    (should.length > 0 || can.length > 0 || didEntries.length > 0)
  ) {
    outcomes.push({ type: "healthy", evidence: {} });
  }

  return { agentId, should, can, did: didEntries, outcomes, evaluatedAt: new Date().toISOString(), shouldUnknown, didTools, now };
}
