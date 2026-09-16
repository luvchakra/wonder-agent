"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setAiProviderConfig } from "@/modules/platform-admin/service";

export async function setAiProviderConfigAction(formData: FormData) {
  const ctx = await requirePermission("ai.manage");

  const useOwnKey = formData.get("useOwnKey") === "on";
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();

  await setAiProviderConfig(ctx.userId, ctx.tenantId!, {
    useOwnKey,
    apiKey: apiKey.length > 0 ? apiKey : undefined,
    model: model.length > 0 ? model : undefined,
  });

  revalidatePath("/settings/ai");
}
