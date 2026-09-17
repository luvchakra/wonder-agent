"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { launchCampaign, recordDecision } from "@/modules/certification-compliance/service";
import type { CampaignCadence, CampaignScopeType, DecisionType } from "@/lib/shared/types/compliance";

export async function launchCampaignAction(formData: FormData) {
  const ctx = await requirePermission("compliance.manage");
  const criticalityRaw = String(formData.get("criticality") ?? "");
  const campaign = await launchCampaign(ctx.tenantId!, ctx.userId, {
    name: String(formData.get("name") ?? ""),
    scopeType: (formData.get("scopeType") as CampaignScopeType) || "agent",
    scope: criticalityRaw ? { criticality: criticalityRaw.split(",").map((s) => s.trim()) } : {},
    cadence: (formData.get("cadence") as CampaignCadence) || "one_time",
    // The Reviewer field is optional and submits "" when left blank, and ""
    // is not null — `?? ctx.userId` never fired, so a blank field sent an
    // empty string straight into certification_items.reviewer_id (a uuid).
    // The campaign row was created first, so every default-path launch from
    // this form 500'd AFTER leaving an orphaned active campaign with zero
    // items behind it.
    reviewerId: String(formData.get("reviewerId") ?? "").trim() || ctx.userId,
  });
  redirect(`/compliance/campaigns/${campaign.id}`);
}

export async function recordDecisionAction(campaignId: string, itemId: string, formData: FormData) {
  const ctx = await requirePermission("compliance.manage");
  await recordDecision(ctx.tenantId!, ctx.userId, itemId, {
    decision: formData.get("decision") as DecisionType,
    justification: String(formData.get("justification") ?? ""),
    delegateToUserId: String(formData.get("delegateToUserId") ?? "") || undefined,
    overrideSoD: formData.get("overrideSoD") === "on",
  });
  redirect(`/compliance/campaigns/${campaignId}`);
}
