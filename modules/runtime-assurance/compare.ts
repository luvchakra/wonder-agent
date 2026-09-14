import "server-only";

import { getAgentContract } from "@/modules/agent-identity/service";
import { getEffectiveAccess } from "@/modules/access-governance/service";
import type { CanEntry, ComparisonOutcome, DidEntry, ShouldCanDidComparison, ShouldEntry } from "@/lib/shared/types/runtime";
import { getDid } from "./did";

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
 */
export async function compareShouldCanDid(tenantId: string, agentId: string): Promise<ShouldCanDidComparison> {
  const [contract, canGrants, did] = await Promise.all([
    getAgentContract(agentId),
    getEffectiveAccess(tenantId, agentId),
    getDid(tenantId, agentId),
  ]);

  const should: ShouldEntry[] = contract
    ? contract.approvedApplications.flatMap((application): ShouldEntry[] =>
        contract.approvedData.length > 0
          ? contract.approvedData.map((data): ShouldEntry => ({ application, data }))
          : [{ application, data: null }],
      )
    : [];

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
    if (!isDidCoveredByCan(can, d)) {
      outcomes.push({
        type: "unexpected_capability",
        evidence: { eventId: d.eventId, application: d.application, resource: d.resource, dataClassification: d.dataClassification },
      });
    }
  }
  for (const d of didEntries) {
    if (!isDidCoveredByShould(should, d)) {
      outcomes.push({
        type: "behavioral_violation",
        evidence: { eventId: d.eventId, application: d.application, resource: d.resource, dataClassification: d.dataClassification },
      });
    }
  }
  if (outcomes.length === 0 && (should.length > 0 || can.length > 0 || didEntries.length > 0)) {
    outcomes.push({ type: "healthy", evidence: {} });
  }

  return { agentId, should, can, did: didEntries, outcomes, evaluatedAt: new Date().toISOString() };
}
