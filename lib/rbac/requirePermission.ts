import "server-only";

import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { ApiError, type TenantContext } from "@/lib/shared/types/foundation";
import { auditRefusal, authorizeContext, refusalError } from "./authorize";

/**
 * Every /api/v1/* route handler in every module calls this (or
 * requirePlatformAdmin() for platform routes) as its first line. See
 * docs/plan/01-FOUNDATION-AGENT-BACKLOG.md FOUNDATION-P0-04.1.
 *
 * FOUNDATION-P0-19 — a thin call to the authorization engine without a
 * resource: tenant-wide grants that are valid now and whose conditions are
 * met, after the tenant's explicit policies. A plain missing permission
 * stays 403 FORBIDDEN as before; a policy, scope or MFA refusal says so
 * (POLICY_DENIED, APPROVAL_REQUIRED, MFA_REQUIRED) and is audited.
 */
export async function requirePermission(permission: string): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) {
    throw new ApiError(401, "NO_TENANT", "No active tenant membership");
  }
  const result = authorizeContext(ctx, permission);
  if (result.decision !== "ALLOW") {
    await auditRefusal(ctx, result);
    throw refusalError(result);
  }
  return ctx;
}

/**
 * Like requirePermission(), but satisfied by any one of `permissions`. For
 * an action two roles legitimately reach by different routes, e.g. revoking
 * an agent's API key as its owner (`agent.update`) or as an incident
 * responder (`runtime.emergency`, FOUNDATION-P0-18).
 */
export async function requireAnyPermission(permissions: string[]): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) {
    throw new ApiError(401, "NO_TENANT", "No active tenant membership");
  }
  if (!permissions.some((p) => ctx.permissions.includes(p))) {
    throw new ApiError(403, "FORBIDDEN", `Missing one of: ${permissions.join(", ")}`);
  }
  return ctx;
}
