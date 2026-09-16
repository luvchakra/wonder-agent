"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setAiProviderConfig } from "@/modules/platform-admin/service";

export async function setAiProviderConfigAction(formData: FormData) {
  const ctx = await requirePermission("ai.manage");

  const useOwnKey = formData.get("useOwnKey") === "on";
  const providerRaw = String(formData.get("provider") ?? "");
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();

  if (providerRaw !== "openai" && providerRaw !== "gemini") {
    throw new Error("provider must be openai or gemini");
  }

  await setAiProviderConfig(ctx.userId, ctx.tenantId!, {
    useOwnKey,
    provider: providerRaw,
    apiKey: apiKey.length > 0 ? apiKey : undefined,
    model: model.length > 0 ? model : undefined,
  });

  revalidatePath("/settings/ai");
}
