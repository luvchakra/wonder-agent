"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { requireAnyPermissionFor } from "@/lib/rbac/authorize";
import { agentResource } from "@/app/_shared/agentScope";
import { engageEmergencyControl, ingestRuntimeEvent, liftEmergencyControl } from "@/modules/runtime-assurance/service";
import { revokeAllAgentApiKeys } from "@/lib/security/agentApiKeys";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RuntimeEventSource } from "@/lib/shared/types/runtime";

export async function submitRuntimeEventAction(agentId: string, formData: FormData) {
  const ctx = await requirePermission("runtime.ingest");
  await ingestRuntimeEvent(ctx.tenantId!, ctx.userId, {
    agentId,
    eventTime: new Date().toISOString(),
    source: (formData.get("source") as RuntimeEventSource) || "rest",
    application: String(formData.get("application") ?? "") || undefined,
    resource: String(formData.get("resource") ?? "") || undefined,
    action: String(formData.get("action") ?? "read"),
    dataClassification: String(formData.get("dataClassification") ?? "") || undefined,
    success: true,
  });
  redirect(`/runtime/agents/${agentId}`);
}

// RUNTIME-P0-18 — emergency controls. Every one needs runtime.emergency,
// a reason, and the UI's confirmation dialog; the service audits it.

type ActionResult = { success: boolean; error?: string };

async function asResult(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    return { success: true };
  } catch (err) {
    if (err instanceof ApiError) return { success: false, error: err.message };
    throw err;
  }
}

export async function engageEmergencyControlAction(controlType: string, target: string | null, reason: string): Promise<ActionResult> {
  return asResult(async () => {
    const ctx = await requirePermission("runtime.emergency");
    await engageEmergencyControl(ctx.tenantId!, ctx.userId, { controlType, target, reason });
    revalidatePath("/runtime");
  });
}

export async function liftEmergencyControlAction(controlId: string, reason: string): Promise<ActionResult> {
  return asResult(async () => {
    const ctx = await requirePermission("runtime.emergency");
    await liftEmergencyControl(ctx.tenantId!, ctx.userId, controlId, reason);
    revalidatePath("/runtime");
  });
}

export async function revokeAllAgentKeysAction(agentId: string, reason: string): Promise<ActionResult> {
  return asResult(async () => {
    const ctx = await requireAnyPermissionFor(["runtime.emergency", "agent.update"], agentResource(agentId));
    await revokeAllAgentApiKeys(ctx.tenantId!, ctx.userId, agentId, reason);
    revalidatePath(`/agents/${agentId}`);
  });
}
