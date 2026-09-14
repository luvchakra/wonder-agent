import "server-only";

import { listIntegrations, listSyncJobs } from "@/modules/integrations/service";
import type { JobStatusSummary } from "@/lib/shared/types/operations";

const FAILURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * OPERATIONS-P0-06.1 — read/presentation only over Integration Agent's
 * existing `integration_sync_jobs` (owned by Integration Agent per the
 * ownership map; this module never queries it directly, only through
 * `listSyncJobs()`). Fans out per integration the same way search fans out
 * per object type — `listSyncJobs()` has no tenant-wide variant, so this
 * is a bounded N+1 over the tenant's own integrations (typically a small
 * number), not a new table or a denormalized cache.
 */
export async function getJobStatusSummary(tenantId: string): Promise<JobStatusSummary[]> {
  const integrations = await listIntegrations(tenantId);
  const cutoff = Date.now() - FAILURE_WINDOW_MS;

  return Promise.all(
    integrations.map(async (integration) => {
      const jobs = await listSyncJobs(tenantId, integration.id);
      const lastSuccessful = jobs.find((j) => j.status === "succeeded");
      const lastRun = jobs[0] ?? null;
      const recentFailures = jobs.filter((j) => j.status === "failed" && j.createdAt && new Date(j.createdAt).getTime() >= cutoff);
      const totalRetries = jobs.reduce((sum, j) => sum + j.retryCount, 0);

      return {
        integrationId: integration.id,
        integrationName: integration.name,
        lastSuccessfulAt: lastSuccessful?.endedAt ?? null,
        lastRunStatus: lastRun?.status ?? null,
        lastRunAt: lastRun?.createdAt ?? null,
        failureCountLast30Days: recentFailures.length,
        totalRetries,
      };
    }),
  );
}
