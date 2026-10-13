"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import {
  activateTenant,
  createAnnouncement,
  createSubscription,
  createTenant,
  createTenantEnvironment,
  decommissionTenant,
  grantPlatformAdmin,
  rollbackConfigVersion,
  setFeatureFlag,
  setWonderappsDashboardAccess,
  suspendTenant,
  updateBranding,
  updateFeatureFlagDefault,
  type AnnouncementScope,
  type AnnouncementType,
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

/** Owner request 2026-10-13: a dev, test or staging environment of a production organization. */
export async function createTenantEnvironmentAction(parentTenantId: string, formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await createTenantEnvironment(userId, parentTenantId, String(formData.get("environment") ?? ""));
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

export async function updateFeatureFlagDefaultAction(formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await updateFeatureFlagDefault(userId, String(formData.get("flagKey") ?? ""), formData.get("defaultEnabled") === "true");
  revalidatePath("/platform-admin/features");
}

export async function rollbackConfigVersionAction(returnPath: string, formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await rollbackConfigVersion(userId, String(formData.get("versionId") ?? ""));
  revalidatePath(returnPath);
}

export async function createAnnouncementAction(formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  const scope = (formData.get("scope") as AnnouncementScope) || "global";
  await createAnnouncement(userId, {
    scope,
    tenantId: scope === "tenant" ? String(formData.get("tenantId") ?? "") || undefined : undefined,
    type: (formData.get("type") as AnnouncementType) || "notice",
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    endsAt: String(formData.get("endsAt") ?? "") || undefined,
  });
  revalidatePath("/platform-admin/announcements");
}

/** Owner decision (2026-10-13): turns the WonderApps dashboard's read access on or off (audited in the service). */
export async function setWonderappsAccessAction(formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await setWonderappsDashboardAccess(userId, formData.get("enabled") === "true");
  revalidatePath("/platform-admin/health");
}
