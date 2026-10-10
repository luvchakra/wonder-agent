import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { connectionDriver } from "./framework/engine";
import { deleteConnectorFiles, listFilesForRetention } from "./framework/files";
import { createSystemSyncJob, runSyncJob } from "./syncJobs";
import { dueConnections, filesToPurge, isConnectionSchedule, type ConnectionSchedule, type ScheduledConnection } from "./connectorScheduleRules";

/**
 * Connection schedules (integrations.schedule, migration 0111) and the
 * daily cron that runs them (/api/cron/connector-syncs). Each run is an
 * ordinary sync job (syncJobs.ts) of trigger `scheduled`, created for the
 * connection's own tenant and idempotent per (connection, window).
 */

/** Sets how often a connection syncs. The caller has checked integration.update; RLS scopes the row. */
export async function setConnectionSchedule(tenantId: string, actorId: string, integrationId: string, schedule: unknown): Promise<ConnectionSchedule> {
  if (!isConnectionSchedule(schedule)) throw new ApiError(400, "INVALID_INPUT", "schedule: manual, hourly or daily");
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integrations")
    .update({ schedule })
    .eq("id", integrationId)
    .eq("tenant_id", tenantId)
    .eq("integration_type_id", "connector")
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "SAVE_FAILED", "The schedule could not be saved");
  if (!data) throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "integration.schedule_changed",
    objectType: "integration",
    objectId: integrationId,
    outcome: "success",
    metadata: { schedule },
  });
  return schedule;
}

export async function getConnectionSchedule(tenantId: string, integrationId: string): Promise<ConnectionSchedule> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("integrations").select("schedule").eq("id", integrationId).eq("tenant_id", tenantId).maybeSingle<{ schedule: string }>();
  if (error) throw new ApiError(500, "QUERY_FAILED", "The schedule could not be read");
  return isConnectionSchedule(data?.schedule) ? data.schedule : "manual";
}

export type ScheduledRunSummary = { due: number; started: number; skipped: number; failed: number; deferred: number; filesPurged: number };

/**
 * Runs every due connection, across tenants, with the service role (there
 * is no session in a cron). Each connection's tenant comes from its own
 * row, and every job, read and write below names that tenant. Runs go a
 * few at a time; connections not started before `budgetMs` wait for the
 * next run (their window is still open, so nothing is lost on an hourly
 * schedule; a daily one runs at the next cron).
 */
export async function runScheduledSyncs(now = new Date(), opts: { budgetMs?: number; concurrency?: number } = {}): Promise<ScheduledRunSummary> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 240_000;
  const supabase = supabaseServiceRole();

  const { data: rows, error } = await supabase
    .from("integrations")
    .select("id, tenant_id, schedule, status, config")
    .eq("integration_type_id", "connector")
    .neq("schedule", "manual")
    .neq("status", "disabled")
    .order("id")
    .limit(2000);
  if (error) throw new Error("scheduled connections could not be listed");
  const connections: ScheduledConnection[] = (rows ?? []).map((r: { id: string; tenant_id: string; schedule: string; status: string; config: Record<string, unknown> | null }) => ({
    id: r.id,
    tenantId: r.tenant_id,
    schedule: r.schedule,
    status: r.status,
    driver: connectionDriver(r.config ?? {}),
  }));

  // The newest scheduled job of each, in the last two days (enough for an hourly or daily window).
  const lastScheduled = new Map<string, string>();
  const tenantOf = new Map(connections.map((c) => [c.id, c.tenantId]));
  const ids = connections.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: jobs, error: jobsError } = await supabase
      .from("integration_sync_jobs")
      .select("integration_id, tenant_id, created_at")
      .eq("trigger", "scheduled")
      .in("integration_id", ids.slice(i, i + 200))
      .gte("created_at", new Date(now.getTime() - 2 * 86_400_000).toISOString())
      .order("created_at", { ascending: false });
    if (jobsError) throw new Error("scheduled jobs could not be listed");
    for (const j of (jobs ?? []) as { integration_id: string; tenant_id: string; created_at: string }[]) {
      // A job counts only for its own connection's tenant.
      if (tenantOf.get(j.integration_id) !== j.tenant_id) continue;
      if (!lastScheduled.has(j.integration_id)) lastScheduled.set(j.integration_id, j.created_at);
    }
  }

  const due = dueConnections(connections, lastScheduled, now);
  const summary: ScheduledRunSummary = { due: due.length, started: 0, skipped: 0, failed: 0, deferred: 0, filesPurged: 0 };
  const queue = [...due];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (Date.now() - started > budgetMs) {
        summary.deferred++;
        continue;
      }
      const { connection, window } = next;
      try {
        // tenantId is the connection row's own tenant_id (read above), never a request value (§14).
        const job = await createSystemSyncJob(connection.tenantId, connection.id, "scheduled", window);
        if (!job) {
          summary.skipped++; // another run already took this window
          continue;
        }
        summary.started++;
        await writeAudit({
          tenantId: connection.tenantId,
          actorType: "system",
          action: "integration.scheduled_sync_started",
          objectType: "integration",
          objectId: connection.id,
          outcome: "success",
          metadata: { jobId: job.id, schedule: connection.schedule, window },
        });
        // runSyncJob records the job's own outcome, audit and failure notification.
        await runSyncJob(connection.tenantId, job.id);
      } catch {
        summary.failed++;
        console.error("scheduled sync could not start", { integrationId: connection.id });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker));

  summary.filesPurged = await purgeReadFiles();
  return summary;
}

/** Keeps each connection's newest received files; older files a sync has read are deleted. */
export async function purgeReadFiles(): Promise<number> {
  let purged = 0;
  for (const group of filesToPurge(await listFilesForRetention())) {
    try {
      purged += await deleteConnectorFiles(group.tenantId, group.integrationId, group.ids);
    } catch {
      console.error("connector files could not be purged", { integrationId: group.integrationId });
    }
  }
  return purged;
}
