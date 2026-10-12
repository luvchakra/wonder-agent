import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { notify } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import type { IntegrationSyncJob, SyncJobMode, SyncJobTrigger } from "@/lib/shared/types/integrations";
import { getTenantConfig } from "@/lib/config/tenantConfig";
import { toSyncJob } from "./mappers";
import { createConnector } from "./registry";
import { getDecryptedCredential, keepObtainedTokens } from "./credentials";
import { openGateway, type GatewaySession } from "./gateway/gateway";
import { planAfterSync, runPipeline } from "./syncPipeline";
import { pipelineStatusOf, type ImportOutcome } from "./pipelineRules";
import { chooseRunMode, heldKinds, kindCompleteness, missingStatusOf, MASS_MISSING_MIN_POPULATION, type KindMissing, type KindRun, type MissingSummary } from "./stagingRules";

/**
 * INTEGRATION-P0-01.3. Creating a job only ever inserts a 'queued' row — RLS
 * (migration 0022) enforces that a client-facing insert can't claim any
 * other status or pre-populate result fields. Runs as the calling user via
 * supabaseServer().
 */
export async function createSyncJob(
  tenantId: string,
  integrationId: string,
  trigger: SyncJobTrigger,
  // INTEGRATION-P0-18: a partial run (an object-page file) never marks anything missing.
  mode: SyncJobMode = "full",
): Promise<IntegrationSyncJob> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integration_sync_jobs")
    .insert({ tenant_id: tenantId, integration_id: integrationId, trigger, mode })
    .select()
    .single();
  // QA-P0-17: 0076's same-tenant foreign keys refuse a reference to another
  // organization's row (23503). Say so, rather than a generic 500.
  if (error?.code === "23503") throw new ApiError(404, "NOT_FOUND", "That integration is not in this organization");
  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create sync job");
  }
  return toSyncJob(data);
}

/**
 * A job created by WonderID itself, with no user session: a scheduled run
 * (cron) or the sync a received file starts. Service role, so `tenantId`
 * must be the connection row's own tenant_id, which the callers read from
 * that row (§14); the insert names it and the same-tenant foreign key
 * (0076) refuses any other. `scheduleWindow` makes a scheduled run
 * idempotent: a second job for the same connection and window is refused
 * by a unique index (0111), and this returns null.
 */
export async function createSystemSyncJob(
  tenantId: string,
  integrationId: string,
  trigger: SyncJobTrigger,
  scheduleWindow: string | null = null,
): Promise<IntegrationSyncJob | null> {
  const { data, error } = await supabaseServiceRole()
    .from("integration_sync_jobs")
    .insert({ tenant_id: tenantId, integration_id: integrationId, trigger, schedule_window: scheduleWindow })
    .select()
    .single();
  if (error?.code === "23505" && scheduleWindow) return null;
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", "The sync job could not be created");
  return toSyncJob(data);
}

export async function getSyncJob(tenantId: string, jobId: string): Promise<IntegrationSyncJob | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("integration_sync_jobs").select().eq("id", jobId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toSyncJob(data) : null;
}

export async function listSyncJobs(tenantId: string, integrationId: string): Promise<IntegrationSyncJob[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integration_sync_jobs")
    .select()
    .eq("integration_id", integrationId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(DEFAULT_LIST_LIMIT);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toSyncJob);
}

/**
 * When each of the tenant's integrations last started a sync that
 * completed (succeeded or partial), in one query. The discovery inbox uses
 * it to flag an object not seen in the latest completed sync, instead of
 * listing every integration's jobs one integration at a time (§15).
 */
export async function listLatestCompletedSyncStarts(tenantId: string): Promise<Map<string, string>> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integration_sync_jobs")
    .select("integration_id, started_at")
    .eq("tenant_id", tenantId)
    .in("status", ["succeeded", "partial"])
    .not("started_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(1000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const latest = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ integration_id: string; started_at: string }>) {
    if (!latest.has(row.integration_id)) latest.set(row.integration_id, row.started_at);
  }
  return latest;
}

/**
 * INTEGRATION-P0-18. For each kind this run read completely (stagingRules),
 * marks the staged objects it did not see as missing at the source, through
 * stage_mark_missing() (0117), which applies the organization's mass-missing
 * guard and never marks what a newer run has seen. Service role; the job and
 * tenant are this run's own. A failure here is recorded, never thrown: the
 * import itself already succeeded.
 */
async function markMissing(tenantId: string, jobId: string, mode: SyncJobMode, kindRuns: Map<string, KindRun>): Promise<MissingSummary> {
  const summary: MissingSummary = {};
  let threshold: number;
  try {
    threshold = (await getTenantConfig(tenantId))["integration.massMissingPercent"];
  } catch {
    // An unreadable setting is never permission: skip marking for this run.
    for (const kind of kindRuns.keys()) summary[kind] = { status: "skipped", reason: "the organization's settings could not be read" };
    return summary;
  }
  for (const [kind, run] of kindRuns) {
    const decision = kindCompleteness(mode, run);
    if (!decision.complete) {
      summary[kind] = { status: "skipped", reason: decision.reason };
      continue;
    }
    const { data, error } = await supabaseServiceRole().rpc("stage_mark_missing", {
      p_tenant: tenantId,
      p_job: jobId,
      p_kind: kind,
      p_threshold_percent: threshold,
      p_min_population: MASS_MISSING_MIN_POPULATION,
    });
    const row = (Array.isArray(data) ? data[0] : data) as { candidates: number; present_before: number; marked: number; held: boolean } | null;
    if (error || !row) {
      summary[kind] = { status: "skipped", reason: "marking failed; nothing was marked" };
      continue;
    }
    summary[kind] = row.held
      ? { status: "held", candidates: row.candidates, presentBefore: row.present_before, thresholdPercent: threshold }
      : { status: "marked", marked: row.marked, candidates: row.candidates, presentBefore: row.present_before };
  }
  return summary;
}

/**
 * INTEGRATION-P0-21: when this connection's last successful run, and last
 * successful full run, started (the incremental cursor and the daily full
 * read). Partial runs (object-page files) never count.
 */
async function lastGoodRuns(tenantId: string, integrationId: string, jobId: string): Promise<{ lastSucceededStart: string | null; lastFullSucceededStart: string | null }> {
  const base = () =>
    supabaseServiceRole()
      .from("integration_sync_jobs")
      .select("started_at")
      .eq("tenant_id", tenantId)
      .eq("integration_id", integrationId)
      .eq("status", "succeeded")
      .neq("id", jobId)
      .not("started_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1);
  const [{ data: latest, error: latestError }, { data: full, error: fullError }] = await Promise.all([base().in("mode", ["full", "incremental"]), base().eq("mode", "full")]);
  // Not knowing is never a reason to skip: without a cursor the run reads in full.
  if (latestError || fullError) return { lastSucceededStart: null, lastFullSucceededStart: null };
  return {
    lastSucceededStart: ((latest ?? [])[0]?.started_at as string | undefined) ?? null,
    lastFullSucceededStart: ((full ?? [])[0]?.started_at as string | undefined) ?? null,
  };
}

/** integration_objects rows stored per request. */
const UPSERT_CHUNK = 500;

/**
 * INTEGRATION-P0-01.3/02.1/03.1 (higher bar on job result integrity). The
 * actual sync worker. Must be invoked from a request context via
 * `after(() => runSyncJob(...))` (see app/api/v1/integrations/[id]/sync's
 * route) so the triggering request returns immediately with the queued job
 * id — never awaited inline in the API route handler, per the backlog's
 * "do not place a long-running connector job inside the synchronous
 * request/response cycle." Chosen over adding a queue/worker
 * infrastructure dependency: Next.js's built-in `after()` needs no new
 * infra and keeps the triggering response fast, which is what the backlog
 * actually requires — this isn't a "stop and report" situation since a
 * clean, dependency-free mechanism already exists.
 *
 * Runs entirely via the service-role client because job status/counts are
 * integrity-sensitive (see migration 0022's comment) and integration_objects
 * grants no client write policy at all (migration 0023) — every query below
 * explicitly scopes to tenantId itself.
 */
export async function runSyncJob(tenantId: string, jobId: string): Promise<void> {
  const supabase = supabaseServiceRole();

  const { data: jobRow, error: jobError } = await supabase
    .from("integration_sync_jobs")
    .select()
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (jobError || !jobRow) {
    console.error("runSyncJob: job not found", { jobId, tenantId, jobError });
    return;
  }

  await supabase
    .from("integration_sync_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId);

  const errors: { objectType?: string; message: string }[] = [];
  // The run's mode as it actually ran (a scheduled run may become incremental).
  let mode: SyncJobMode = jobRow.mode ?? "full";
  let recordsProcessed = 0;
  let recordsFailed = 0;
  // INTEGRATION-P0-18: what each kind's import did, to decide whether it may mark objects missing.
  const kindRuns = new Map<string, KindRun>();
  // The run's Connector Gateway session: every request of this sync passes it; flushed at the end.
  let gateway: GatewaySession | null = null;
  // INTEGRATION-P0-21: kept so tokens a run obtained are stored even when it fails part way.
  let runConnector: object | null = null;

  try {
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select()
      .eq("id", jobRow.integration_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (integrationError || !integration) {
      throw new Error(integrationError?.message ?? "Integration not found");
    }

    const secret = await getDecryptedCredential(tenantId, integration.id);
    // The gateway session names the connection (its own tenant); the file driver reads received files for it only.
    gateway = openGateway({ tenantId, integrationId: integration.id, status: integration.status });
    const connector = createConnector(integration.integration_type_id, gateway);
    runConnector = connector;
    await connector.authenticate(integration.config ?? {}, secret);

    // INTEGRATION-P0-21: a scheduled run reads only what changed, when it may (chooseRunMode).
    const requested: SyncJobMode = jobRow.mode ?? "full";
    if (requested !== "partial" && (requested === "incremental" || jobRow.trigger === "scheduled")) {
      const supportsIncremental = connector.supportsIncremental();
      const decided = chooseRunMode({
        requested,
        trigger: jobRow.trigger,
        supportsIncremental,
        ...(supportsIncremental ? await lastGoodRuns(tenantId, integration.id, jobId) : { lastSucceededStart: null, lastFullSucceededStart: null }),
        now: new Date(),
      });
      if (decided.since) connector.readChangesSince(decided.since);
      if (decided.mode !== requested) await supabase.from("integration_sync_jobs").update({ mode: decided.mode }).eq("tenant_id", tenantId).eq("id", jobId);
      mode = decided.mode;
    }

    // Every kind the connection's definition reads, in import order (an MCP
    // server before its tools, so the inventory can tell what is still declared).
    for (const objectType of connector.kinds()) {
      const run: KindRun = { failed: false, storeFailures: 0, unmapped: 0, truncated: false, unread: false };
      kindRuns.set(objectType, run);
      try {
        const records = await connector.importKind(objectType);
        const rows = records.map((record) => ({
          tenant_id: tenantId,
          integration_id: integration.id,
          object_type: objectType,
          external_id: record.externalId,
          raw: record.raw,
          normalized: record.normalized ?? {},
          sync_job_id: jobId,
          // Seen again: no longer missing at the source.
          missing_at_source_at: null,
        }));
        // Stored 500 at a time; a chunk that fails is retried row by row so
        // each bad record is counted and named, never the whole chunk.
        for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
          const chunk = rows.slice(i, i + UPSERT_CHUNK);
          const { error: chunkError } = await supabase.from("integration_objects").upsert(chunk, { onConflict: "integration_id,object_type,external_id" });
          if (!chunkError) {
            recordsProcessed += chunk.length;
            continue;
          }
          for (const row of chunk) {
            const { error: upsertError } = await supabase.from("integration_objects").upsert(row, { onConflict: "integration_id,object_type,external_id" });
            if (upsertError) {
              recordsFailed += 1;
              run.storeFailures += 1;
              errors.push({ objectType, message: upsertError.message });
            } else recordsProcessed += 1;
          }
        }
        // Records the definition could not map are reported, not stored half-filled.
        for (const issue of connector.drainIssues()) {
          recordsFailed += 1;
          run.unmapped += 1;
          errors.push(issue);
        }
        Object.assign(run, connector.readReport(objectType));
      } catch (err) {
        run.failed = true;
        errors.push({
          objectType,
          message: `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }
    }

    // LDAP and SQL drivers hold a connection open for the run.
    await connector.close();

    const finalStatus = errors.length === 0 ? "succeeded" : recordsProcessed > 0 ? "partial" : "failed";

    // INTEGRATION-P0-18: objects a complete full read did not see are missing at the source.
    const missingSummary = finalStatus === "failed" ? {} : await markMissing(tenantId, jobId, mode, kindRuns);
    const missingStatus = missingStatusOf(missingSummary);

    // INTEGRATION-P0-19: what follows the import (identity sources, then account reconciliation),
    // saved with the import's result so the job never looks finished while it runs.
    const importOutcome: ImportOutcome = {
      mode,
      status: finalStatus,
      kindsRead: [...kindRuns.keys()],
      kindsFailed: [...kindRuns].filter(([, r]) => r.failed).map(([kind]) => kind),
    };
    const pipeline = await planAfterSync(tenantId, integration.id, importOutcome);
    const pipelineStatus = pipelineStatusOf(pipeline, finalStatus);

    await supabase
      .from("integration_sync_jobs")
      .update({
        status: finalStatus,
        ended_at: new Date().toISOString(),
        records_processed: recordsProcessed,
        records_failed: recordsFailed,
        errors,
        missing_status: missingStatus,
        missing_summary: missingSummary,
        pipeline,
        pipeline_status: pipelineStatus,
      })
      .eq("id", jobId);

    await supabase.from("integrations").update({ last_sync_at: new Date().toISOString() }).eq("id", integration.id);

    await writeAudit({
      tenantId,
      actorType: "system",
      action: "integration.sync_completed",
      objectType: "integration_sync_job",
      objectId: jobId,
      outcome: finalStatus === "failed" ? "failure" : "success",
      correlationId: jobRow.correlation_id,
      metadata: { status: finalStatus, recordsProcessed, recordsFailed, integrationId: integration.id, missingStatus, missingSummary },
    });

    // A held run waits for a person (approve or discard on the connection's page).
    if (missingStatus === "held") {
      await notify({
        tenantId,
        type: "integration_failure",
        title: `Sync held for review: ${integration.name}`,
        body: "More records than usual are gone from the source. Nothing was marked missing; approve or discard on the connection's page.",
        referenceType: "integration_sync_job",
        referenceId: jobId,
      });
    }

    if (pipelineStatus === "running") {
      const result = await runPipeline(tenantId, jobId, integration.id, pipeline, finalStatus);
      await writeAudit({
        tenantId,
        actorType: "system",
        action: "integration.pipeline_completed",
        objectType: "integration_sync_job",
        objectId: jobId,
        outcome: result.status === "failed" ? "failure" : "success",
        correlationId: jobRow.correlation_id,
        metadata: { integrationId: integration.id, status: result.status, steps: result.steps },
      });
      if (result.status === "failed") {
        const failed = result.steps.find((st) => st.status === "failed");
        await notify({
          tenantId,
          type: "integration_failure",
          title: `Update after sync failed: ${integration.name}`,
          body: failed ? `${failed.name}: ${failed.reason ?? "failed"}. Later steps did not run.` : "A step after the import did not run.",
          referenceType: "integration_sync_job",
          referenceId: jobId,
        });
      }
    }

    // OPERATIONS-P0-02.2 — wired per that story's own instruction that
    // each producing module picks this up in its own work. Only a
    // "failed" outcome notifies; "partial" (some records still imported)
    // is visible on the job-status page without an alert-level interrupt.
    if (finalStatus === "failed") {
      await notify({
        tenantId,
        type: "integration_failure",
        title: `Integration sync failed: ${integration.name}`,
        body: errors[0]?.message ?? "Sync failed with no recorded records processed.",
        referenceType: "integration_sync_job",
        referenceId: jobId,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await supabase
      .from("integration_sync_jobs")
      .update({
        status: "failed",
        ended_at: new Date().toISOString(),
        records_processed: recordsProcessed,
        records_failed: recordsFailed,
        errors: [...errors, { message }],
      })
      .eq("id", jobId);

    await writeAudit({
      tenantId,
      actorType: "system",
      action: "integration.sync_completed",
      objectType: "integration_sync_job",
      objectId: jobId,
      outcome: "failure",
      correlationId: jobRow.correlation_id,
      metadata: { status: "failed", message },
    });

    await notify({
      tenantId,
      type: "integration_failure",
      title: "Integration sync failed",
      body: message,
      referenceType: "integration_sync_job",
      referenceId: jobId,
    });
  } finally {
    await keepObtainedTokens(tenantId, jobRow.integration_id, runConnector);
    await gateway?.flush();
  }
}

/**
 * INTEGRATION-P0-18. A person decides a run the mass-missing guard held:
 * approve marks the held kinds' unseen objects missing (stage_mark_missing()
 * without the guard, so still never what a newer run has seen); discard
 * marks nothing. The decision is claimed with a conditional update, so two
 * people deciding at once cannot both apply it. Approving is refused once a
 * newer run of the connection has started: its result, not this one's, is
 * the current view of the source. Service role; every query names the
 * caller's tenant (§14).
 */
export async function resolveHeldMissing(
  tenantId: string,
  actorId: string,
  integrationId: string,
  jobId: string,
  decision: "approve" | "discard",
): Promise<IntegrationSyncJob> {
  const supabase = supabaseServiceRole();
  const { data: job, error } = await supabase
    .from("integration_sync_jobs")
    .select("id, tenant_id, integration_id, started_at, missing_status, missing_summary, correlation_id")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .eq("integration_id", integrationId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", "The sync job could not be read");
  if (!job || job.tenant_id !== tenantId) throw new ApiError(404, "JOB_NOT_FOUND", "Sync job not found");
  if (job.missing_status !== "held") throw new ApiError(409, "NOT_HELD", "This run is not waiting for a decision");

  if (decision === "approve") {
    const { count, error: newerError } = await supabase
      .from("integration_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("integration_id", job.integration_id)
      .gt("started_at", job.started_at);
    if (newerError) throw new ApiError(500, "QUERY_FAILED", "Newer runs could not be checked");
    if ((count ?? 0) > 0) throw new ApiError(409, "SUPERSEDED", "A newer run has started; discard this one");
  }

  const resolvedAt = new Date().toISOString();
  const status = decision === "approve" ? "approved" : "discarded";
  const { data: claimed, error: claimError } = await supabase
    .from("integration_sync_jobs")
    .update({ missing_status: status, missing_resolved_by: actorId, missing_resolved_at: resolvedAt })
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .eq("missing_status", "held")
    .select("id");
  if (claimError) throw new ApiError(500, "UPDATE_FAILED", "The decision could not be saved");
  if (!claimed?.length) throw new ApiError(409, "NOT_HELD", "This run was already decided");

  const summary = { ...(job.missing_summary as MissingSummary) };
  for (const kind of heldKinds(summary)) {
    const held = summary[kind] as Extract<KindMissing, { status: "held" }>;
    if (decision === "discard") {
      summary[kind] = { status: "discarded", candidates: held.candidates, presentBefore: held.presentBefore };
      continue;
    }
    const { data, error: markError } = await supabase.rpc("stage_mark_missing", {
      p_tenant: tenantId,
      p_job: jobId,
      p_kind: kind,
      p_threshold_percent: null,
      p_min_population: MASS_MISSING_MIN_POPULATION,
    });
    const row = (Array.isArray(data) ? data[0] : data) as { candidates: number; present_before: number; marked: number } | null;
    summary[kind] =
      markError || !row
        ? { status: "skipped", reason: "marking failed after approval; nothing was marked" }
        : { status: "approved", marked: row.marked, candidates: row.candidates, presentBefore: row.present_before };
  }

  const { data: updated, error: updateError } = await supabase
    .from("integration_sync_jobs")
    .update({ missing_summary: summary })
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: decision === "approve" ? "integration.sync_missing_approved" : "integration.sync_missing_discarded",
    objectType: "integration_sync_job",
    objectId: jobId,
    outcome: updateError ? "failure" : "success",
    correlationId: job.correlation_id,
    metadata: { integrationId: job.integration_id, missingSummary: summary },
  });

  if (updateError || !updated) throw new ApiError(500, "UPDATE_FAILED", "The result could not be saved");
  return toSyncJob(updated);
}
