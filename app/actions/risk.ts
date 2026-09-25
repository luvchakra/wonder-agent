"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  addInvestigationNote,
  assignFinding,
  assignInvestigation,
  changeInvestigationStatus,
  createInvestigation,
  evaluateAgentRisk,
  getFinding,
  remediateFinding,
  resolveFinding,
  transitionFindingStatus,
  validateCreateInvestigation,
} from "@/modules/risk/service";
import type { FindingStatus, InvestigationStatus, ResolutionType } from "@/lib/shared/types/risk";

export async function evaluateAgentRiskAction(agentId: string) {
  const ctx = await requirePermission("risk.manage");
  await evaluateAgentRisk(ctx.tenantId!, agentId);
  redirect(`/risk/agents/${agentId}`);
}

export async function assignFindingAction(agentId: string, findingId: string, formData: FormData) {
  const ctx = await requirePermission("risk.manage");
  await assignFinding(ctx.tenantId!, ctx.userId, findingId, String(formData.get("assigneeId") ?? ""));
  redirect(`/risk/agents/${agentId}`);
}

export async function remediateFindingAction(agentId: string, findingId: string) {
  const ctx = await requirePermission("risk.manage");
  await remediateFinding(ctx.tenantId!, ctx.userId, findingId);
  redirect(`/risk/agents/${agentId}`);
}

export async function resolveFindingAction(agentId: string, findingId: string, formData: FormData) {
  const ctx = await requirePermission("risk.manage");
  const type = formData.get("resolutionType") as ResolutionType;
  let stillTriggered = false;
  if (type === "verified_fixed") {
    const existing = await getFinding(ctx.tenantId!, findingId);
    if (existing) {
      const reEvaluated = await evaluateAgentRisk(ctx.tenantId!, agentId);
      stillTriggered = reEvaluated.some((f) => f.category === existing.category);
    }
  }
  await resolveFinding(ctx.tenantId!, ctx.userId, findingId, {
    type,
    reason: String(formData.get("reason") ?? "") || undefined,
    stillTriggered,
    expiresAt: String(formData.get("expiresAt") ?? "") || undefined,
  });
  redirect(`/risk/agents/${agentId}`);
}

export async function transitionFindingStatusAction(agentId: string, findingId: string, formData: FormData) {
  const ctx = await requirePermission("risk.manage");
  const status = formData.get("status") as FindingStatus;
  await transitionFindingStatus(ctx.tenantId!, ctx.userId, findingId, status);
  redirect(`/risk/agents/${agentId}`);
}

/**
 * RISK-P0-11 — investigations. These return the real result or error for
 * the form to show (§17.5); creating one redirects to it only once it
 * exists.
 */
export type InvestigationFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

function investigationError(err: unknown): InvestigationFormState {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
}

export async function createInvestigationAction(_prev: InvestigationFormState, formData: FormData): Promise<InvestigationFormState> {
  const ctx = await requirePermission("risk.manage");
  let id: string;
  try {
    const input = validateCreateInvestigation({
      title: formData.get("title"),
      summary: formData.get("summary"),
      priority: formData.get("priority") || undefined,
      findingIds: formData.getAll("findingIds").map(String),
    });
    id = (await createInvestigation(ctx.tenantId!, ctx.userId, input)).id;
  } catch (err) {
    return investigationError(err);
  }
  redirect(`/risk/investigations/${id}`);
}

export async function changeInvestigationStatusAction(investigationId: string, _prev: InvestigationFormState, formData: FormData): Promise<InvestigationFormState> {
  const ctx = await requirePermission("risk.manage");
  try {
    const to = String(formData.get("status") ?? "") as InvestigationStatus;
    const updated = await changeInvestigationStatus(ctx.tenantId!, ctx.userId, investigationId, to, String(formData.get("reason") ?? "") || null);
    revalidatePath(`/risk/investigations/${investigationId}`);
    return { status: "saved", message: `Status is now ${updated.status.replace(/_/g, " ")}.` };
  } catch (err) {
    return investigationError(err);
  }
}

export async function assignInvestigationAction(investigationId: string, _prev: InvestigationFormState, formData: FormData): Promise<InvestigationFormState> {
  const ctx = await requirePermission("risk.manage");
  try {
    const assigneeId = String(formData.get("assigneeId") ?? "") || null;
    await assignInvestigation(ctx.tenantId!, ctx.userId, investigationId, assigneeId);
    revalidatePath(`/risk/investigations/${investigationId}`);
    return { status: "saved", message: assigneeId ? "Assigned." : "Unassigned." };
  } catch (err) {
    return investigationError(err);
  }
}

export async function addInvestigationNoteAction(investigationId: string, _prev: InvestigationFormState, formData: FormData): Promise<InvestigationFormState> {
  const ctx = await requirePermission("risk.manage");
  try {
    await addInvestigationNote(ctx.tenantId!, ctx.userId, investigationId, String(formData.get("note") ?? ""));
    revalidatePath(`/risk/investigations/${investigationId}`);
    return { status: "saved", message: "Note added." };
  } catch (err) {
    return investigationError(err);
  }
}
