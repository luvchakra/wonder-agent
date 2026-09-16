import "server-only";

import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/writeAudit";
import { toCsv } from "./csv";
import type { GovernanceEvidencePack } from "@/lib/shared/types/compliance";
import type { EvidencePackExportResult, EvidencePackFormat } from "@/lib/shared/types/operations";

type EvidencePackRow = { section: string; id: string; details: string };

/**
 * Flattens the nested GovernanceEvidencePack into one row per underlying
 * record for CSV — the same "one row per source-module record, a details
 * column carrying the rest" flattening reports.ts already uses (its
 * `fields` object per row), reused here rather than inventing a
 * pack-specific CSV shape.
 */
function flattenEvidencePack(pack: GovernanceEvidencePack): EvidencePackRow[] {
  const rows: EvidencePackRow[] = [];
  const add = (section: string, id: string, record: unknown) => rows.push({ section, id, details: JSON.stringify(record) });

  add("identity.agent", pack.identity.agent.id, pack.identity.agent);
  if (pack.identity.contract) add("identity.contract", pack.identity.contract.id, pack.identity.contract);
  pack.identity.owners.forEach((o) => add("identity.owner", o.id, o));
  pack.identity.identities.forEach((i) => add("identity.identity", i.id, i));
  pack.identity.lifecycleEvents.forEach((e) => add("identity.lifecycleEvent", e.id, e));
  pack.access.effectiveAccess.forEach((g) => add("access.grant", g.id, g));
  pack.access.policyEvaluations.forEach((e) => add("access.policyEvaluation", e.id, e));
  pack.access.exceptions.forEach((e) => add("access.exception", e.id, e));
  pack.shouldCanDid.outcomes.forEach((o, idx) => add("shouldCanDid.outcome", String(idx), o));
  pack.risk.findings.forEach((f) => add("risk.finding", f.id, f));
  pack.certifications.forEach((d) => add("certification.decision", d.id, d));
  pack.attestations.forEach((a) => add("attestation", a.id, a));
  pack.controlMappings.forEach((m) => add("controlMapping", m.id, m));
  pack.remediation.accessRequests.forEach((r) => add("remediation.accessRequest", r.id, r));
  pack.auditEvents.forEach((e) => add("auditEvent", e.id, e));
  pack.posture.dimensions.forEach((d) => add("posture.dimension", d.dimension, d));
  add("posture.status", pack.agentId, { status: pack.posture.status, coveringExceptionIds: pack.posture.coveringExceptionIds });

  return rows;
}

/**
 * OPERATIONS-P0-07 — turns Compliance's assembled GovernanceEvidencePack
 * into a downloadable file. This module never reaches into Compliance's
 * (or any other module's) tables directly — the pack is handed to it
 * already assembled, satisfying non-negotiable #6. Reuses
 * OPERATIONS-P0-01.2's existing evidence-export pattern (audited export
 * event, content hash) rather than building a second exporter.
 */
export async function exportGovernanceEvidencePack(
  actorId: string,
  pack: GovernanceEvidencePack,
  format: EvidencePackFormat,
): Promise<EvidencePackExportResult> {
  const canonicalContent = JSON.stringify(pack);
  const contentHash = createHash("sha256").update(canonicalContent).digest("hex");

  const content = format === "csv" ? toCsv(flattenEvidencePack(pack)) : canonicalContent;
  const contentType = format === "csv" ? "text/csv" : "application/json";
  const filename = `governance-evidence-pack-${pack.agentId}.${format}`;

  await writeAudit({
    tenantId: pack.tenantId,
    actorId,
    actorType: "user",
    action: "operations.evidence_pack_exported",
    objectType: "agent",
    objectId: pack.agentId,
    outcome: "success",
    metadata: { format, contentHash },
  });

  return { content, contentType, filename, contentHash };
}
