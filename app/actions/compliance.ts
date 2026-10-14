"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { launchCampaign, launchCampaignFromTemplate, recordDecision, saveCampaignTemplate } from "@/modules/certification-compliance/service";
import type { CampaignCadence, CampaignScopeType, DecisionType } from "@/lib/shared/types/compliance";

export async function launchCampaignAction(formData: FormData) {
  const ctx = await requirePermission("compliance.manage");
  const criticalityRaw = String(formData.get("criticality") ?? "");
  const input = {
    name: String(formData.get("name") ?? ""),
    scopeType: (formData.get("scopeType") as CampaignScopeType) || "agent",
    scope: {
      ...(criticalityRaw ? { criticality: criticalityRaw.split(",").map((s) => s.trim()) } : {}),
      // COMPLIANCE-P0-10: people's access, optionally privileged only.
      ...(formData.get("privilegedOnly") === "on" ? { privilegedOnly: true } : {}),
    },
    reviewerKind: (String(formData.get("reviewerKind") ?? "") || undefined) as "named" | "manager" | "application_owner" | undefined,
    cadence: (formData.get("cadence") as CampaignCadence) || "one_time",
    // The Reviewer field is optional and submits "" when left blank, and ""
    // is not null — `?? ctx.userId` never fired, so a blank field sent an
    // empty string straight into certification_items.reviewer_id (a uuid).
    // The campaign row was created first, so every default-path launch from
    // this form 500'd AFTER leaving an orphaned active campaign with zero
    // items behind it.
    reviewerId: String(formData.get("reviewerId") ?? "").trim() || ctx.userId,
  };
  const campaign = await launchCampaign(ctx.tenantId!, ctx.userId, input);
  // COMPLIANCE-P0-14: optionally kept as a template for the next launch (the reviewer stays as typed; blank means whoever launches).
  if (formData.get("saveTemplate") === "on") {
    await saveCampaignTemplate(ctx.tenantId!, ctx.userId, { ...input, reviewerId: String(formData.get("reviewerId") ?? "").trim() || null });
  }
  redirect(`/compliance/campaigns/${campaign.ref ?? campaign.id}`);
}

/** COMPLIANCE-P0-14: an ordinary campaign from a saved template. */
export async function launchFromTemplateAction(templateId: string) {
  const ctx = await requirePermission("compliance.manage");
  const campaign = await launchCampaignFromTemplate(ctx.tenantId!, ctx.userId, templateId);
  redirect(`/compliance/campaigns/${campaign.ref ?? campaign.id}`);
}

export async function recordDecisionAction(campaignId: string, itemId: string, formData: FormData) {
  const ctx = await requirePermission("compliance.read");
  await recordDecision(ctx.tenantId!, ctx.userId, itemId, {
    decision: formData.get("decision") as DecisionType,
    justification: String(formData.get("justification") ?? ""),
    delegateToUserId: String(formData.get("delegateToUserId") ?? "") || undefined,
    overrideSoD: formData.get("overrideSoD") === "on",
    until: String(formData.get("until") ?? "") || undefined,
    canManageCompliance: ctx.permissions.includes("compliance.manage"),
  });
  redirect(`/compliance/campaigns/${campaignId}`);
}
