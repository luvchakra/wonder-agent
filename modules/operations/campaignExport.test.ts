// @vitest-environment node
import { describe, expect, it } from "vitest";
import { exportCampaignEvidencePackage } from "./campaignExport";
import type { EvidenceExportPackage } from "@/lib/shared/types/compliance";

function makePackage(): EvidenceExportPackage {
  return {
    campaign: { id: "campaign-1", tenantId: "tenant-a", name: "Q3 Review", scopeType: "agent", scope: {}, cadence: "one_time", status: "completed", dueDate: null, createdBy: "user-1", createdAt: "x" },
    items: [
      {
        id: "item-1",
        tenantId: "tenant-a",
        campaignId: "campaign-1",
        agentId: "agent-1",
        accessGrantId: "grant-1",
        reviewerId: "user-2",
        riskAtReview: "high",
        usageAtReview: "used",
        recommendation: "review",
        status: "decided",
        dueDate: null,
        createdAt: "x",
        snapshot: null,
        escalatedAt: null,
        escalatedTo: null,
        decisions: [
          { id: "decision-1", itemId: "item-1", decision: "approve", justification: "ok", decidedBy: "user-2", decidedAt: "x", remediationId: null, snapshot: null },
        ],
      },
    ],
    exportedAt: "2026-09-16T00:00:00Z",
    exportedBy: "user-1",
    contentHash: "abc123",
  };
}

describe("exportCampaignEvidencePackage — COMPLIANCE-P0-06 file delivery", () => {
  it("produces JSON content matching the package, reusing its existing content hash", () => {
    const pkg = makePackage();
    const result = exportCampaignEvidencePackage(pkg, "json");
    expect(result.contentType).toBe("application/json");
    expect(JSON.parse(result.content as string)).toEqual(pkg);
    expect(result.contentHash).toBe("abc123");
  });

  it("produces a flattened CSV covering the campaign, its items and their decisions", () => {
    const pkg = makePackage();
    const result = exportCampaignEvidencePackage(pkg, "csv");
    expect(result.contentType).toBe("text/csv");
    const lines = (result.content as string).split("\n");
    expect(lines[0]).toBe("section,id,details");
    expect(lines).toHaveLength(4); // header + campaign + item + decision
    expect(lines[1]).toContain("campaign,campaign-1");
    expect(lines[2]).toContain("certification_item,item-1");
    expect(lines[3]).toContain("certification_decision,decision-1");
  });
});
