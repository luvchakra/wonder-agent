"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setConnectionSchedule, setConnectionWrites } from "@/modules/integrations/service";

/** Sets how often a connection syncs (manual, hourly, daily). Needs integration.update; audited by the service. */
export async function setConnectionScheduleAction(integrationId: string, formData: FormData): Promise<void> {
  const ctx = await requirePermission("integration.update");
  await setConnectionSchedule(ctx.tenantId!, ctx.userId, integrationId, formData.get("schedule"));
  revalidatePath("/integrations/[id]", "page");
}

/**
 * INTEGRATION-P0-13 (D3): turns a connection's writes on or off. Needs
 * integration.update; the service declares only what the definition
 * supports and audits the change.
 */
export async function setConnectionWritesAction(integrationId: string, formData: FormData): Promise<void> {
  const ctx = await requirePermission("integration.update");
  await setConnectionWrites(ctx.tenantId!, ctx.userId, integrationId, formData.get("enabled") === "true");
  revalidatePath("/integrations/[id]", "page");
}
