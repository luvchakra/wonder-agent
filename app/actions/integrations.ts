"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  createIntegration,
  createMapping,
  createSyncJob,
  runSyncJob,
  setCredential,
  testIntegrationConnection,
} from "@/modules/integrations/service";
import type { AuthType } from "@/lib/shared/types/integrations";

export async function createIntegrationAction(formData: FormData) {
  const ctx = await requirePermission("integration.create");
  const integration = await createIntegration(ctx.tenantId!, ctx.userId, {
    integrationTypeId: String(formData.get("integrationTypeId")),
    name: String(formData.get("name") ?? ""),
    config: { baseUrl: String(formData.get("baseUrl") ?? "") || undefined },
  });
  redirect(`/integrations/${integration.id}`);
}

export async function setCredentialAction(integrationId: string, formData: FormData) {
  const ctx = await requirePermission("integration.update");
  await setCredential(
    ctx.tenantId!,
    ctx.userId,
    integrationId,
    formData.get("authType") as AuthType,
    String(formData.get("secret") ?? ""),
  );
  redirect(`/integrations/${integrationId}`);
}

export async function testConnectionAction(integrationId: string) {
  const ctx = await requirePermission("integration.execute");
  await testIntegrationConnection(ctx.tenantId!, integrationId);
  redirect(`/integrations/${integrationId}`);
}

export async function triggerSyncAction(integrationId: string) {
  const ctx = await requirePermission("integration.execute");
  const job = await createSyncJob(ctx.tenantId!, integrationId, "manual");
  // Server actions don't have next/server's request-scoped after(); run the
  // (already fire-and-forget by design) sync without awaiting so this
  // action still returns promptly.
  void runSyncJob(ctx.tenantId!, job.id);
  redirect(`/integrations/${integrationId}`);
}

export async function createMappingAction(integrationId: string, formData: FormData) {
  await requirePermission("integration.update");
  await createMapping(
    integrationId,
    String(formData.get("objectType") ?? ""),
    String(formData.get("sourceField") ?? ""),
    String(formData.get("targetField") ?? ""),
  );
  redirect(`/integrations/${integrationId}`);
}
