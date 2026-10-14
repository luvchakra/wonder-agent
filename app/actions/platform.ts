"use server";

import { ApiError } from "@/lib/shared/types/foundation";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin, requirePlatformAdminOrBootstrap } from "@/lib/rbac/requirePlatformAdmin";
import {
  activateTenant,
  createAnnouncement,
  endAnnouncement,
  createSubscription,
  createTenant,
  createTenantEnvironment,
  renameTenantSlug,
  removeTenantEnvironment,
  changePlan,
  setTenantEnvironment,
  decommissionTenant,
  grantPlatformAdmin,
  rollbackConfigVersion,
  setFeatureFlag,
  setTenantNotes,
  setOrganizationPlan,
  removeOrganization,
  saveOrganizationProfile,
  renameOrganization,
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
  revalidatePath("/platform-admin/tenants", "layout");
}

export type TenantSettingState = { ok: boolean; message: string | null };

const settingError = (err: unknown): TenantSettingState => ({ ok: false, message: err instanceof ApiError ? err.message : "Something went wrong. Try again." });

/** Owner request 2026-10-13: change an organization's address prefix (platform administrators only). */
export async function renameTenantSlugAction(tenantId: string, _prev: TenantSettingState, formData: FormData): Promise<TenantSettingState> {
  const { userId } = await requirePlatformAdmin();
  try {
    const { to } = await renameTenantSlug(userId, tenantId, String(formData.get("slug") ?? ""));
    revalidatePath("/platform-admin/tenants", "layout");
    return { ok: true, message: `Address changed to ${to}.` };
  } catch (err) {
    return settingError(err);
  }
}

/** Owner request 2026-10-13: change an organization's environment (platform administrators only). */
export async function setTenantEnvironmentAction(tenantId: string, _prev: TenantSettingState, formData: FormData): Promise<TenantSettingState> {
  const { userId } = await requirePlatformAdmin();
  try {
    await setTenantEnvironment(userId, tenantId, String(formData.get("environment") ?? ""));
    revalidatePath("/platform-admin/tenants", "layout");
    return { ok: true, message: "Environment saved." };
  } catch (err) {
    return settingError(err);
  }
}

/** Owner request 2026-10-13: change an organization's plan after it was assigned. */
export async function changePlanAction(tenantId: string, _prev: TenantSettingState, formData: FormData): Promise<TenantSettingState> {
  const { userId } = await requirePlatformAdmin();
  try {
    const sub = await changePlan(userId, tenantId, formData.get("plan") as SubscriptionPlan);
    revalidatePath("/platform-admin/tenants", "layout");
    return { ok: true, message: `Plan: ${sub.plan}.` };
  } catch (err) {
    return settingError(err);
  }
}

/** Owner request 2026-10-13: remove an environment from its organization (decommissioned, address freed). */
export async function removeTenantEnvironmentAction(tenantId: string, organizationId: string) {
  const { userId } = await requirePlatformAdmin();
  await removeTenantEnvironment(userId, tenantId);
  revalidatePath("/platform-admin/tenants", "layout");
  redirect(`/platform-admin/tenants/${organizationId}`);
}

/** Owner request 2026-10-13: a dev, test or staging environment of a production organization. */
export async function createTenantEnvironmentAction(parentTenantId: string, formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await createTenantEnvironment(userId, parentTenantId, String(formData.get("environment") ?? ""));
  revalidatePath("/platform-admin/tenants", "layout");
}

export async function suspendTenantAction(tenantId: string) {
  const { userId } = await requirePlatformAdmin();
  await suspendTenant(userId, tenantId);
  revalidatePath("/platform-admin/tenants", "layout");
}

export async function activateTenantAction(tenantId: string) {
  const { userId } = await requirePlatformAdmin();
  await activateTenant(userId, tenantId);
  revalidatePath("/platform-admin/tenants", "layout");
}

export async function decommissionTenantAction(tenantId: string) {
  const { userId } = await requirePlatformAdmin();
  await decommissionTenant(userId, tenantId);
  revalidatePath("/platform-admin/tenants", "layout");
}

export async function createSubscriptionAction(tenantId: string, formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await createSubscription(userId, tenantId, formData.get("plan") as SubscriptionPlan);
  revalidatePath("/platform-admin/tenants", "layout");
}

export async function setFeatureFlagAction(tenantId: string, formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await setFeatureFlag(userId, tenantId, String(formData.get("flagKey") ?? ""), formData.get("enabled") === "true");
  revalidatePath("/platform-admin/features");
  revalidatePath("/platform-admin/tenants", "layout");
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
  // WID-H10: the one thing a PLATFORM_ADMIN_EMAILS address may do is add an entry to platform_admins (audited).
  const { userId } = await requirePlatformAdminOrBootstrap();
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

/** Owner request 2026-10-13: end a notice now. */
export async function endAnnouncementAction(announcementId: string) {
  const { userId } = await requirePlatformAdmin();
  await endAnnouncement(userId, announcementId);
  revalidatePath("/platform-admin/announcements");
}

/** Owner decision (2026-10-13): turns the WonderApps dashboard's read access on or off (audited in the service). */
export async function setWonderappsAccessAction(formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await setWonderappsDashboardAccess(userId, formData.get("enabled") === "true");
  revalidatePath("/platform-admin/health");
}

/** Owner request 2026-10-13: rename an organization from the console; its environments follow. */
export async function renameOrganizationAction(tenantId: string, _prev: TenantSettingState, formData: FormData): Promise<TenantSettingState> {
  const { userId } = await requirePlatformAdmin();
  try {
    await renameOrganization(userId, tenantId, String(formData.get("name") ?? ""));
    revalidatePath("/platform-admin/tenants", "layout");
    return { ok: true, message: "Name saved." };
  } catch (err) {
    return settingError(err);
  }
}

/** Owner request 2026-10-13: an organization's description, contacts and company details. */
export async function saveOrganizationProfileAction(tenantId: string, _prev: TenantSettingState, formData: FormData): Promise<TenantSettingState> {
  const { userId } = await requirePlatformAdmin();
  try {
    await saveOrganizationProfile(userId, tenantId, Object.fromEntries(formData.entries()));
    revalidatePath("/platform-admin/tenants", "layout");
    return { ok: true, message: "Details saved." };
  } catch (err) {
    return settingError(err);
  }
}

/** Owner request 2026-10-13: a platform administrator's notes on an environment. */
export async function setTenantNotesAction(tenantId: string, _prev: TenantSettingState, formData: FormData): Promise<TenantSettingState> {
  const { userId } = await requirePlatformAdmin();
  try {
    await setTenantNotes(userId, tenantId, String(formData.get("notes") ?? ""));
    revalidatePath("/platform-admin/tenants", "layout");
    return { ok: true, message: "Notes saved." };
  } catch (err) {
    return settingError(err);
  }
}

/** Owner decision 2026-10-13: one plan per organization, set for every environment at once. */
export async function setOrganizationPlanAction(organizationId: string, _prev: TenantSettingState, formData: FormData): Promise<TenantSettingState> {
  const { userId } = await requirePlatformAdmin();
  try {
    const { changed } = await setOrganizationPlan(userId, organizationId, formData.get("plan") as SubscriptionPlan);
    revalidatePath("/platform-admin/tenants", "layout");
    return { ok: true, message: `Plan set for ${changed === 1 ? "the organization" : `all ${changed} environments`}.` };
  } catch (err) {
    return settingError(err);
  }
}

/** Owner request 2026-10-13: remove a whole organization (it and its environments are decommissioned, data kept). */
export async function removeOrganizationAction(organizationId: string) {
  const { userId } = await requirePlatformAdmin();
  await removeOrganization(userId, organizationId);
  revalidatePath("/platform-admin/tenants", "layout");
  redirect("/platform-admin/tenants");
}
