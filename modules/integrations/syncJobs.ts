import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { notify } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type {
  ConnectorCapabilities,
  IntegrationObjectType,
  IntegrationSyncJob,
  SyncJobTrigger,
} from "@/lib/shared/types/integrations";
import { toSyncJob } from "./mappers";
import { createConnector } from "./registry";
import { getDecryptedCredential } from "./credentials";
import { applyMappings, listMappings } from "./mappings";
import type { ConnectorAdapter, ImportedRecord } from "./connector";

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
): Promise<IntegrationSyncJob> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integration_sync_jobs")
    .insert({ tenant_id: tenantId, integration_id: integrationId, trigger })
    .select()
    .single();
  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create sync job");
  }
  return toSyncJob(data);
}

export async function getSyncJob(tenantId: string, jobId: string): Promise<IntegrationSyncJob | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("integration_sync_jobs").select().eq("id", jobId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toSyncJob(data) : null;
}

export async function listSyncJobs(tenantId: string, integrationId: string): Promise<IntegrationSyncJob[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integration_sync_jobs")
    .select()
    .eq("integration_id", integrationId)
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toSyncJob);
}

const IMPORTERS: {
  capabilityKey: keyof ConnectorCapabilities;
  objectType: IntegrationObjectType;
  importFn: (connector: ConnectorAdapter) => Promise<ImportedRecord<unknown>[]> | undefined;
}[] = [
  { capabilityKey: "importIdentities", objectType: "identity", importFn: (c) => c.importIdentities?.() },
  { capabilityKey: "importAccounts", objectType: "account", importFn: (c) => c.importAccounts?.() },
  { capabilityKey: "importApplications", objectType: "application", importFn: (c) => c.importApplications?.() },
  { capabilityKey: "importEntitlements", objectType: "entitlement", importFn: (c) => c.importEntitlements?.() },
  { capabilityKey: "importAccess", objectType: "access_grant", importFn: (c) => c.importAccess?.() },
  { capabilityKey: "importPolicies", objectType: "policy", importFn: (c) => c.importPolicies?.() },
];

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
  let recordsProcessed = 0;
  let recordsFailed = 0;

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
    const connector = createConnector(integration.integration_type_id);
    await connector.authenticate(integration.config ?? {}, secret);

    const capabilities: ConnectorCapabilities = integration.capabilities ?? {};

    for (const { capabilityKey, objectType, importFn } of IMPORTERS) {
      if (!capabilities[capabilityKey]) continue;

      let mappings: Awaited<ReturnType<typeof listMappings>> = [];
      try {
        const records = (await importFn(connector)) ?? [];
        for (const record of records) {
          try {
            let normalized = record.normalized as Record<string, unknown> | undefined;
            if (!normalized) {
              if (mappings.length === 0) {
                mappings = await listMappings(integration.id, objectType);
              }
              normalized = applyMappings(record.raw, mappings);
            }

            const { error: upsertError } = await supabase.from("integration_objects").upsert(
              {
                tenant_id: tenantId,
                integration_id: integration.id,
                object_type: objectType,
                external_id: record.externalId,
                raw: record.raw,
                normalized,
                sync_job_id: jobId,
              },
              { onConflict: "integration_id,object_type,external_id" },
            );
            if (upsertError) throw new Error(upsertError.message);
            recordsProcessed += 1;
          } catch (err) {
            recordsFailed += 1;
            errors.push({
              objectType,
              message: err instanceof Error ? err.message : "Unknown error",
            });
          }
        }
      } catch (err) {
        errors.push({
          objectType,
          message: `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }
    }

    const finalStatus = errors.length === 0 ? "succeeded" : recordsProcessed > 0 ? "partial" : "failed";

    await supabase
      .from("integration_sync_jobs")
      .update({
        status: finalStatus,
        ended_at: new Date().toISOString(),
        records_processed: recordsProcessed,
        records_failed: recordsFailed,
        errors,
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
      metadata: { status: finalStatus, recordsProcessed, recordsFailed, integrationId: integration.id },
    });

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
  }
}
