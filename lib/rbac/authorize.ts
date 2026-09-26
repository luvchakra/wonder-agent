import "server-only";

import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError, type TenantContext } from "@/lib/shared/types/foundation";
import { authorize as evaluate, type AuthorizationResult, type ResourceRef } from "./authorizeCore";

/**
 * FOUNDATION-P0-19 — the authorization engine for a request: the current
 * tenant context's grants and policies, evaluated by the deterministic
 * core (authorizeCore.ts). requirePermission() asks it without a resource;
 * routes that act on one agent or application ask with that resource, so
 * scoped assignments and scoped policies apply to them.
 */

export type { AuthorizationResult, ResourceRef } from "./authorizeCore";

export function authorizeContext(ctx: TenantContext, permission: string, resource?: ResourceRef | null): AuthorizationResult {
  if (!ctx.grants) {
    // A context without the engine's facts (built in a test): its permission list is the whole answer.
    const allowed = ctx.permissions.includes(permission);
    return {
      decision: allowed ? "ALLOW" : "DENY",
      reasons: allowed ? ["PERMISSION_MATCH"] : ["PERMISSION_MISSING"],
      permission,
      matched: [],
      notApplied: [],
      policies: [],
    };
  }
  return evaluate(ctx.grants, ctx.policies ?? [], { permission, resource, now: new Date(), aal: ctx.aal ?? null });
}

/** The error a refusal becomes; the same shape requirePermission() has always thrown. */
export function refusalError(result: AuthorizationResult): ApiError {
  if (result.decision === "REQUIRE_APPROVAL") {
    const names = result.policies.filter((p) => !p.exempt && p.effect === "REQUIRE_APPROVAL").map((p) => p.name);
    return new ApiError(403, "APPROVAL_REQUIRED", `Needs approval under ${names.join(", ")}: ${result.permission}`);
  }
  if (result.reasons.includes("POLICY_DENY")) {
    const names = result.policies.filter((p) => !p.exempt && p.effect === "DENY").map((p) => p.name);
    return new ApiError(403, "POLICY_DENIED", `Denied by ${names.join(", ")}: ${result.permission}`);
  }
  if (result.reasons.includes("MFA_REQUIRED")) return new ApiError(403, "MFA_REQUIRED", `Multi-factor authentication is required for: ${result.permission}`);
  return new ApiError(403, "FORBIDDEN", `Missing permission: ${result.permission}`);
}

/**
 * Like requirePermission(), for an action on one resource. `load` resolves
 * the resource's scope attributes inside the caller's tenant (null when it
 * does not exist there; the check then counts tenant-wide grants only and
 * the route's own lookup answers 404).
 */
export async function requirePermissionFor(permission: string, load: (tenantId: string) => Promise<ResourceRef | null>): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) throw new ApiError(401, "NO_TENANT", "No active tenant membership");
  const resource = await load(ctx.tenantId);
  const result = authorizeContext(ctx, permission, resource);
  if (result.decision !== "ALLOW") {
    await auditRefusal(ctx, result, resource);
    throw refusalError(result);
  }
  return ctx;
}

/**
 * Refusals the tenant has asked for explicitly (a policy) or that turn on
 * scope or MFA are audited as AUTHORIZATION_DENIED (spec §34); a plain
 * missing permission is not, as before — the UI hides what a role lacks,
 * so those are noise.
 */
export async function auditRefusal(ctx: TenantContext, result: AuthorizationResult, resource?: ResourceRef | null): Promise<void> {
  if (result.reasons.includes("PERMISSION_MISSING") || !ctx.tenantId) return;
  await writeAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorType: "user",
    action: "AUTHORIZATION_DENIED",
    objectType: resource?.type ?? "permission",
    objectId: resource?.id ?? result.permission,
    outcome: "failure",
    metadata: {
      permission: result.permission,
      decision: result.decision,
      reasons: result.reasons,
      policies: result.policies.filter((p) => !p.exempt).map((p) => p.name),
      notApplied: result.notApplied.map((n) => ({ role: n.role, via: n.via, reason: n.reason })),
    },
  });
}

/** Like requireAnyPermission(), for an action on one resource: any one of `permissions` allowed there. */
export async function requireAnyPermissionFor(permissions: string[], load: (tenantId: string) => Promise<ResourceRef | null>): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) throw new ApiError(401, "NO_TENANT", "No active tenant membership");
  const resource = await load(ctx.tenantId);
  const results = permissions.map((p) => authorizeContext(ctx, p, resource));
  if (results.some((r) => r.decision === "ALLOW")) return ctx;
  await auditRefusal(ctx, results[0]!, resource);
  throw refusalError(results[0]!);
}
