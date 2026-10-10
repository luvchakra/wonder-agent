"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setConnectionSchedule } from "@/modules/integrations/service";

/** Sets how often a connection syncs (manual, hourly, daily). Needs integration.update; audited by the service. */
export async function setConnectionScheduleAction(integrationId: string, formData: FormData): Promise<void> {
  const ctx = await requirePermission("integration.update");
  await setConnectionSchedule(ctx.tenantId!, ctx.userId, integrationId, formData.get("schedule"));
  revalidatePath(`/integrations/${integrationId}`);
}
