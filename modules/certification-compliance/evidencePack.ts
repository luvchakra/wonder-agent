import "server-only";

import {
  getAgent,
  getAgentContract,
  listOwners,
  listAgentIdentities,
  listLifecycleEvents,
} from "@/modules/agent-identity/service";
import {
  getEffectiveAccess,
  listPolicyEvaluations,
  listGovernanceExceptions,
  listAccessRequests,
} from "@/modules/access-governance/service";
import { compareShouldCanDid } from "@/modules/runtime-assurance/service";
import { getFindings } from "@/modules/risk/service";
import { listAuditLogs } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { GovernanceEvidencePack } from "@/lib/shared/types/compliance";
import { getCertificationHistory } from "./decisions";
import { listAttestationsForAgent } from "./attestations";
import { listControlFrameworks, listControls, listControlMappings } from "./controls";
import { getGovernancePosture } from "./posture";

const AUDIT_PAGE_SIZE = 200;

/**
 * COMPLIANCE-P0-09 — Governance Evidence Pack assembly. Composes a single
 * per-agent evidence bundle by calling every relevant module's
 * already-published read contract in parallel — never by querying another
 * module's tables directly (non-negotiable #6). This function only
 * produces the structured bundle; turning it into a downloadable
 * PDF/CSV/JSON file is OPERATIONS-P0-07's job
 * (`modules/operations/evidencePackExport.ts`).
 */
export async function assembleGovernanceEvidencePack(tenantId: string, agentId: string): Promise<GovernanceEvidencePack> {
  const agent = await getAgent(tenantId, agentId);
  if (!agent) throw new ApiError(404, "NOT_FOUND", "Agent not found");

  const contract = await getAgentContract(agentId, tenantId);

  const [
    owners,
    identities,
    lifecycleEvents,
    effectiveAccess,
    policyEvaluations,
    exceptions,
    accessRequests,
    shouldCanDid,
    findings,
    certifications,
    attestations,
    auditPage,
    posture,
  ] = await Promise.all([
    listOwners(tenantId, agentId),
    listAgentIdentities(tenantId, agentId),
    listLifecycleEvents(tenantId, agentId),
    getEffectiveAccess(tenantId, agentId),
    listPolicyEvaluations(tenantId, agentId),
    listGovernanceExceptions(tenantId, { agentId }),
    listAccessRequests(tenantId, agentId),
    compareShouldCanDid(tenantId, agentId),
    getFindings(tenantId, { agentId }),
    getCertificationHistory(tenantId, agentId),
    listAttestationsForAgent(tenantId, agentId),
    listAuditLogs(tenantId, { objectType: "agent" }, null, AUDIT_PAGE_SIZE),
    getGovernancePosture(tenantId, agentId),
  ]);

  // Control mappings relevant to this agent — the same correlation
  // COMPLIANCE-P0-07's compliance_controls dimension already performs:
  // the contract's free-text requiredComplianceControls refs, matched to
  // controls by controlRef, then to this tenant's mapping for that control.
  let controlMappings: GovernanceEvidencePack["controlMappings"] = [];
  if (contract && contract.requiredComplianceControls.length > 0) {
    const frameworks = await listControlFrameworks();
    const allControls = (await Promise.all(frameworks.map((f) => listControls(f.id)))).flat();
    const controlsByRef = new Map(allControls.map((c) => [c.controlRef, c]));
    const requiredControlIds = new Set(
      contract.requiredComplianceControls.map((ref) => controlsByRef.get(ref)?.id).filter((id): id is string => !!id),
    );
    const allMappings = await listControlMappings(tenantId);
    controlMappings = allMappings.filter((m) => requiredControlIds.has(m.controlId));
  }

  const auditEvents = auditPage.entries.filter((e) => e.objectId === agentId);

  return {
    agentId,
    tenantId,
    generatedAt: new Date().toISOString(),
    identity: { agent, contract, owners, identities, lifecycleEvents },
    access: { effectiveAccess, policyEvaluations, exceptions },
    shouldCanDid,
    risk: { findings },
    certifications,
    attestations,
    controlMappings,
    remediation: { accessRequests },
    auditEvents,
    posture,
  };
}
