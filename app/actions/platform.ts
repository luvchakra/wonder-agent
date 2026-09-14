"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import {
  activateTenant,
  createSubscription,
  createTenant,
  decommissionTenant,
  grantPlatformAdmin,
  setFeatureFlag,
  suspendTenant,
  updateBranding,
} from "@/modules/platform-admin/service";
import type { SubscriptionPlan, TenantEnvironment } from "@/lib/shared/types/platform";

export async function createTenantAction(formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await createTenant(userId, {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    environment: (formData.get("environment") as TenantEnvironment) || "production",
  });
  revalidatePath("/platform-admin/tenants");
}

export async function suspendTenantAction(tenantId: string) {
  const { userId } = await requirePlatformAdmin();
  await suspendTenant(userId, tenantId);
  revalidatePath("/platform-admin/tenants");
}

export async function activateTenantAction(tenantId: string) {
  const { userId } = await requirePlatformAdmin();
  await activateTenant(userId, tenantId);
  revalidatePath("/platform-admin/tenants");
}

export async function decommissionTenantAction(tenantId: string) {
  const { userId } = await requirePlatformAdmin();
  await decommissionTenant(userId, tenantId);
  revalidatePath("/platform-admin/tenants");
}

export async function createSubscriptionAction(tenantId: string, formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await createSubscription(userId, tenantId, formData.get("plan") as SubscriptionPlan);
  revalidatePath("/platform-admin/tenants");
}

export async function setFeatureFlagAction(tenantId: string, formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await setFeatureFlag(userId, tenantId, String(formData.get("flagKey") ?? ""), formData.get("enabled") === "true");
  revalidatePath("/platform-admin/features");
}

export async function updateBrandingAction(formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await updateBranding(userId, {
    productName: String(formData.get("productName") ?? "") || undefined,
    supportUrl: String(formData.get("supportUrl") ?? "") || undefined,
    docsUrl: String(formData.get("docsUrl") ?? "") || undefined,
    defaultTheme: (formData.get("defaultTheme") as "light" | "dark" | "system") || undefined,
  });
  revalidatePath("/platform-admin/branding");
}

export async function grantPlatformAdminAction(formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await grantPlatformAdmin(userId, String(formData.get("targetUserId") ?? ""));
  revalidatePath("/platform-admin/admins");
}
