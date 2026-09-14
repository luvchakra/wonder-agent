import "server-only";

import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { EvidenceExportPackage } from "@/lib/shared/types/compliance";
import { listCampaigns, listCampaignItems } from "./campaigns";
import { listDecisionsForItem } from "./decisions";

/**
 * COMPLIANCE-P0-06. Assembles the full evidence bundle for a campaign
 * (metadata, every item, every decision with reviewer identity and
 * justification) and computes a SHA-256 content hash over its canonical
 * JSON — a saved copy of the export can be verified against this hash
 * later to detect tampering. This module owns assembling the
 * compliance-specific evidence content; whether the generic export
 * file/delivery mechanism belongs here or to Operations Agent's existing
 * export machinery is flagged, not decided, in the ownership map (per this
 * story's own note) — this function returns the assembled package/hash,
 * with delivery left to the caller.
 */
export async function exportCampaignEvidence(tenantId: string, actorId: string, campaignId: string): Promise<EvidenceExportPackage> {
  const campaigns = await listCampaigns(tenantId);
  const campaign = campaigns.find((c) => c.id === campaignId);
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND");

  const items = await listCampaignItems(tenantId, campaignId);
  const itemsWithDecisions = await Promise.all(
    items.map(async (item) => ({ ...item, decisions: await listDecisionsForItem(tenantId, item.id) })),
  );

  const exportedAt = new Date().toISOString();
  // The hash covers only the content that answers "what happened in this
  // campaign" — exportedAt/exportedBy are metadata about the export event
  // itself, not part of what's being attested, so they're excluded from
  // what gets hashed (otherwise every re-export of unchanged evidence
  // would produce a different, non-comparable hash).
  const canonicalContent = JSON.stringify({ campaign, items: itemsWithDecisions });
  const contentHash = createHash("sha256").update(canonicalContent).digest("hex");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "compliance.evidence_exported",
    objectType: "certification_campaign",
    objectId: campaignId,
    outcome: "success",
    metadata: { itemCount: items.length, contentHash },
  });

  return { campaign, items: itemsWithDecisions, exportedAt, exportedBy: actorId, contentHash };
}
