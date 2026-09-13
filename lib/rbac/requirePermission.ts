import "server-only";

import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { ApiError, type TenantContext } from "@/lib/shared/types/foundation";

/**
 * Every /api/v1/* route handler in every module calls this (or
 * requirePlatformAdmin() for platform routes) as its first line. See
 * docs/plan/01-FOUNDATION-AGENT-BACKLOG.md FOUNDATION-P0-04.1.
 */
export async function requirePermission(permission: string): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) {
    throw new ApiError(401, "NO_TENANT", "No active tenant membership");
  }
  if (!ctx.permissions.includes(permission)) {
    throw new ApiError(403, "FORBIDDEN", `Missing permission: ${permission}`);
  }
  return ctx;
}
