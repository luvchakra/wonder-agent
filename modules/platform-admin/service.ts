import "server-only";

/**
 * The published contract for the Platform Agent's module
 * (docs/plan/09-PLATFORM-AGENT-BACKLOG.md). Other modules must import from
 * this file only — never query platform_tenants/subscriptions/
 * feature_flags/platform_audit_logs directly. `isFeatureEnabled()` is the
 * one function every other module is expected to call.
 */

export { createTenant, listTenants, getTenant, suspendTenant, activateTenant, decommissionTenant, type CreateTenantInput } from "./tenants";
export { createSubscription, getSubscription, updateSubscriptionStatus, PLAN_DEFAULTS } from "./subscriptions";
export { isFeatureEnabled, listFlagCatalog, listTenantFlagOverrides, setFeatureFlag } from "./featureFlags";
export { grantPlatformAdmin, revokePlatformAdmin, listPlatformAdmins } from "./admins";
export { getBranding, updateBranding, type UpdateBrandingInput } from "./branding";
export { getPlatformHealth } from "./health";
export { checkUsageLimit, getUsageSummary, classifyUsage, type UsageResource, type UsageCheck } from "./usage";
export { updateFeatureFlagDefault } from "./featureFlags";
export { listConfigVersions, rollbackConfigVersion, type ConfigType, type ConfigVersion } from "./configRollback";
export {
  createAnnouncement,
  listAnnouncements,
  getActiveAnnouncements,
  type CreateAnnouncementInput,
  type PlatformAnnouncement,
  type AnnouncementScope,
  type AnnouncementType,
} from "./announcements";
