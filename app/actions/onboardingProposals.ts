"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { applyOnboardingProposal, createOnboardingProposal, dismissOnboardingProposal } from "@/modules/integrations/service";

/**
 * INTEGRATION-P0-12 — proposal forms on the onboarding page. The real
 * outcome is returned (§17.5): a proposal is only ever a proposal, and
 * applying one says what still has to happen.
 */
export type ProposalFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

function formError(err: unknown): ProposalFormState {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
}

export async function createProposalAction(applicationId: string, _prev: ProposalFormState, formData: FormData): Promise<ProposalFormState> {
  const ctx = await requirePermission("integration.update");
  try {
    const p = await createOnboardingProposal(ctx.tenantId!, ctx.userId, applicationId, { kind: formData.get("kind"), text: formData.get("text") });
    revalidatePath(`/access/applications/${applicationId}/onboarding`);
    return { status: "saved", message: `Proposal ready (${p.overallConfidence} confidence${p.aiUsed ? (p.aiError ? "; the AI step did not help" : "; refined by AI") : ""}). Review it below.` };
  } catch (err) {
    return formError(err);
  }
}

export async function decideProposalAction(applicationId: string, proposalId: string, _prev: ProposalFormState, formData: FormData): Promise<ProposalFormState> {
  const ctx = await requirePermission("integration.update");
  const action = formData.get("action");
  try {
    if (action === "apply") {
      await requirePermission("access.manage");
      await applyOnboardingProposal(ctx.tenantId!, ctx.userId, proposalId);
    } else {
      await dismissOnboardingProposal(ctx.tenantId!, ctx.userId, proposalId);
    }
    revalidatePath(`/access/applications/${applicationId}/onboarding`);
    return {
      status: "saved",
      message: action === "apply" ? "Applied to the draft configuration. Validate, simulate and have it approved before anything goes live." : "Dismissed.",
    };
  } catch (err) {
    return formError(err);
  }
}
