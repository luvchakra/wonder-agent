import "server-only";

import { ApiError } from "@/lib/shared/types/foundation";
import { getConfigVersion } from "./configVersions";
import { updateBranding } from "./branding";
import { updateFeatureFlagDefault } from "./featureFlags";
import type { PlatformBranding } from "@/lib/shared/types/platform";

export { listConfigVersions, type ConfigType, type ConfigVersion } from "./configVersions";

/**
 * PLATFORM-P0-05.3's rollback path. Reapplies a prior version's
 * `oldValue` through the same update function (and therefore the same
 * validation/versioning/audit path) the original change went through —
 * never a raw table write — so the rollback itself is versioned and
 * audited exactly like any other config change, never erasing the
 * history it's rolling back from. Lives above `branding.ts`/
 * `featureFlags.ts` in the import graph specifically to avoid the
 * circular import that would result from `configVersions.ts` calling
 * back into the files that call it.
 */
export async function rollbackConfigVersion(actorId: string, versionId: string): Promise<void> {
  const version = await getConfigVersion(versionId);
  if (!version) throw new ApiError(404, "VERSION_NOT_FOUND");

  if (version.configType === "branding") {
    const old = (version.oldValue ?? {}) as Partial<PlatformBranding>;
    await updateBranding(actorId, {
      productName: old.productName,
      logoUrl: old.logoUrl ?? undefined,
      faviconUrl: old.faviconUrl ?? undefined,
      supportUrl: old.supportUrl ?? undefined,
      docsUrl: old.docsUrl ?? undefined,
      defaultEmailSender: old.defaultEmailSender ?? undefined,
      defaultTheme: old.defaultTheme,
    });
    return;
  }

  if (version.configType === "feature_flag_default") {
    if (!version.configKey) throw new ApiError(500, "INVALID_VERSION", "feature_flag_default version is missing its configKey");
    const old = version.oldValue as { defaultEnabled: boolean };
    await updateFeatureFlagDefault(actorId, version.configKey, old.defaultEnabled);
    return;
  }

  throw new ApiError(500, "UNKNOWN_CONFIG_TYPE", `No rollback handler for config type: ${version.configType}`);
}
