import "server-only";

import { toCsv } from "./csv";
import type { EvidenceExportPackage } from "@/lib/shared/types/compliance";
import type { EvidencePackExportResult, EvidencePackFormat } from "@/lib/shared/types/operations";

type ExportRow = { section: string; id: string; details: string };

function flattenCampaignPackage(pkg: EvidenceExportPackage): ExportRow[] {
  const rows: ExportRow[] = [{ section: "campaign", id: pkg.campaign.id, details: JSON.stringify(pkg.campaign) }];
  for (const item of pkg.items) {
    const { decisions, ...itemFields } = item;
    rows.push({ section: "certification_item", id: item.id, details: JSON.stringify(itemFields) });
    for (const decision of decisions) {
      rows.push({ section: "certification_decision", id: decision.id, details: JSON.stringify(decision) });
    }
  }
  return rows;
}

/**
 * COMPLIANCE-P0-06's "actual export file/delivery mechanism," previously
 * left unbuilt pending the Compliance-vs-Operations ownership question —
 * resolved by the same 2026-09-15 decision ("Compliance assembles,
 * Operations exports") this module already implements for
 * COMPLIANCE-P0-09/OPERATIONS-P0-07's governance evidence pack. Unlike
 * that pack, Compliance's `exportCampaignEvidence()` already computes its
 * own content hash and writes its own audit event at assembly time
 * (`compliance.evidence_exported`) — this function only serializes the
 * already-hashed, already-audited package into a file; it does not
 * recompute the hash or write a second audit event for the same export
 * action.
 */
export function exportCampaignEvidencePackage(pkg: EvidenceExportPackage, format: EvidencePackFormat): EvidencePackExportResult {
  const content = format === "csv" ? toCsv(flattenCampaignPackage(pkg)) : JSON.stringify(pkg);
  const contentType = format === "csv" ? "text/csv" : "application/json";
  const filename = `campaign-evidence-${pkg.campaign.id}.${format}`;
  return { content, contentType, filename, contentHash: pkg.contentHash };
}
