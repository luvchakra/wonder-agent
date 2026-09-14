"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ingestRuntimeEvent } from "@/modules/runtime-assurance/service";
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
