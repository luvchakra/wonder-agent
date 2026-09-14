import "server-only";

import { createHash } from "node:crypto";
import type { TenantContext } from "@/lib/shared/types/foundation";
import { ApiError } from "@/lib/shared/types/foundation";
import { writeAudit } from "@/lib/audit/writeAudit";

export type JobContext = {
  readonly tenantId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
};

/**
 * FOUNDATION-P0-08 — shared job-security primitive.
 *
 * Every background/async job in WonderAgent must carry tenant context
 * resolved server-side, use an idempotency key, enforce authorization at
 * creation time, and be structurally unable to execute across tenants
 * (CLAUDE.md non-negotiables #1, #2, #4). This wrapper is how a module's own
 * job-creation code gets that for free instead of re-deriving tenant
 * context/authorization plumbing per module (the exact drift this story
 * exists to prevent — see docs/plan/01-FOUNDATION-AGENT-BACKLOG.md
 * FOUNDATION-P0-08).
 *
 * Deliberately NOT a shared jobs table/queue — each module owns its own job
 * table (e.g. Integration Agent's `integration_sync_jobs`) with a schema
 * shaped for its own job's status/progress fields; this wrapper only
 * standardizes the tenant-context/authorization/idempotency envelope around
 * whatever a module's job body actually does, so `tenant_id` can never come
 * from anywhere but an already-verified `TenantContext` and every job
 * carries a real idempotency key from the moment it starts.
 *
 * Usage: a module's own "start sync"/"start campaign"/etc. server code
 * calls `requirePermission(...)` as normal, then passes the resulting
 * `TenantContext` (never a client-supplied tenantId) into this wrapper along
 * with its own idempotency key (e.g. a hash of the job's real inputs) and a
 * job body function that does the actual work (including writing to the
 * module's own job-status table). On an uncaught error from the job body,
 * this wrapper writes a `job.failed` audit event before rethrowing — it
 * never swallows a job failure.
 *
 * NOT retrofitted into Integration Agent's existing `integration_sync_jobs`
 * code in this story — per CLAUDE.md non-negotiable #18, a module agent must
 * never modify another module's implementation to make its own story pass.
 * Recorded in this module's own audit log as a recommendation for
 * Integration Agent's next run to adopt, rather than done unilaterally here.
 */
export async function runTenantScopedJob<T>(
  ctx: TenantContext,
  requiredPermission: string,
  idempotencyKey: string,
  jobBody: (job: JobContext) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantId) {
    throw new ApiError(401, "NO_TENANT", "Jobs must carry a resolved tenant context");
  }
  if (!ctx.permissions.includes(requiredPermission)) {
    throw new ApiError(403, "FORBIDDEN", `Missing permission to create job: ${requiredPermission}`);
  }
  if (!idempotencyKey) {
    throw new ApiError(400, "MISSING_IDEMPOTENCY_KEY", "A job must be created with an idempotency key");
  }

  const job: JobContext = Object.freeze({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    idempotencyKey,
  });

  try {
    return await jobBody(job);
  } catch (err) {
    await writeAudit({
      tenantId: job.tenantId,
      actorId: job.actorId,
      actorType: "system",
      action: "job.failed",
      objectType: "job",
      objectId: job.idempotencyKey,
      outcome: "failure",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/** Deterministic idempotency-key helper for callers that hash their own job inputs. */
export function computeIdempotencyKey(parts: (string | number | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex");
}
