import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { listApplicationsReconciledFrom, reconcileApplicationAccountsAsSystem } from "@/modules/access-governance/service";
import { listSourcesReadingConnection, runSourceAfterSync } from "./identitySources";
import { pipelineStatusOf, planPipeline, skipFrom, type ImportOutcome, type PipelineStatus, type PipelineStep } from "./pipelineRules";

/**
 * INTEGRATION-P0-19 — what happens after a sync, with no one starting it:
 * the identity sources that read the connection promote its identities
 * (Integration's own reconciliation), then each application onboarded on
 * the connection reconciles its accounts (Access's published service).
 * Every step is recorded on the sync job as it starts and ends, so the
 * connection page shows progress. Runs as the system with the service
 * role; `tenantId` is always the job row's own tenant (§14).
 */

/** The steps that will follow this import, or one failed step when they cannot be determined. */
export async function planAfterSync(tenantId: string, integrationId: string, outcome: ImportOutcome): Promise<PipelineStep[]> {
  if (outcome.mode !== "full") return [];
  try {
    const [sources, applications] = await Promise.all([
      outcome.kindsRead.includes("identity") ? listSourcesReadingConnection(tenantId, integrationId) : Promise.resolve([]),
      outcome.kindsRead.includes("account") ? listApplicationsReconciledFrom(tenantId, integrationId) : Promise.resolve([]),
    ]);
    return planPipeline(outcome, sources, applications);
  } catch {
    // Not knowing what to promote is a failure to report, never a quiet "nothing to do".
    return [{ kind: "identities", targetId: "", name: "Finding what to update", status: "failed", reason: "The connection's identity sources and applications could not be read" }];
  }
}

async function save(tenantId: string, jobId: string, steps: PipelineStep[], status: PipelineStatus): Promise<void> {
  await supabaseServiceRole().from("integration_sync_jobs").update({ pipeline: steps, pipeline_status: status }).eq("tenant_id", tenantId).eq("id", jobId);
}

async function runStep(tenantId: string, jobId: string, integrationId: string, step: PipelineStep): Promise<PipelineStep> {
  if (step.kind === "identities") {
    // Re-read at run time: a source paused since the plan is not run.
    const sources = await listSourcesReadingConnection(tenantId, integrationId);
    const source = sources.find((s) => s.id === step.targetId);
    if (!source) return { ...step, status: "skipped", reason: "The identity source is no longer active" };
    const out = await runSourceAfterSync(tenantId, source, jobId);
    const c = out.counts;
    return {
      ...step,
      status: out.status === "failed" ? "failed" : out.status === "partial" ? "partial" : "succeeded",
      runId: out.runId || undefined,
      counts: { seen: c.seen, created: c.created, updated: c.updated, unchanged: c.unchanged, pending: c.pending, leavers: c.leavers, invalid: c.invalid, errors: c.errors },
      reason: out.error ?? (out.guardTripped ? "Leavers held: too many identities missing at once" : undefined),
    };
  }
  try {
    const run = await reconcileApplicationAccountsAsSystem(tenantId, step.targetId);
    return {
      ...step,
      status: run.status === "succeeded" ? "succeeded" : "failed",
      runId: run.id,
      counts: { seen: run.sourceAccounts, created: run.created, updated: run.updated, correlated: run.correlated, orphan: run.orphan, ambiguous: run.ambiguous, notInSource: run.notInSource },
      reason: run.error ?? undefined,
    };
  } catch (err) {
    return { ...step, status: "failed", reason: err instanceof Error ? err.message.slice(0, 300) : "Account reconciliation failed" };
  }
}

/**
 * Runs the pending steps in order, saving each as it starts and ends. A
 * failed step skips the rest. Returns the final steps and status, which are
 * also saved on the job.
 */
export async function runPipeline(
  tenantId: string,
  jobId: string,
  integrationId: string,
  planned: PipelineStep[],
  importStatus: ImportOutcome["status"],
): Promise<{ steps: PipelineStep[]; status: PipelineStatus }> {
  let steps = planned;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].status !== "pending") continue;
    steps = steps.map((s, j) => (j === i ? { ...s, status: "running" as const } : s));
    await save(tenantId, jobId, steps, "running");
    let result: PipelineStep;
    try {
      result = await runStep(tenantId, jobId, integrationId, steps[i]);
    } catch (err) {
      result = { ...steps[i], status: "failed", reason: err instanceof Error ? err.message.slice(0, 300) : "The step failed" };
    }
    steps = steps.map((s, j) => (j === i ? result : s));
    if (result.status === "failed") {
      steps = skipFrom(steps, i + 1, `${result.name} failed`);
      break;
    }
  }
  const status = pipelineStatusOf(steps, importStatus);
  await save(tenantId, jobId, steps, status);
  return { steps, status };
}
