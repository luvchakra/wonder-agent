"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assignFinding, evaluateAgentRisk, remediateFinding, resolveFinding, transitionFindingStatus, getFinding } from "@/modules/risk/service";
import type { FindingStatus, ResolutionType } from "@/lib/shared/types/risk";

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
