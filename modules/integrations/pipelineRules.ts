/**
 * INTEGRATION-P0-19 — pure rules (no I/O) for the chain that follows a
 * sync: import → promotion of identities (the identity sources reading the
 * connection) → reconciliation of accounts (the applications onboarded on
 * it) → their entitlements and grants, for applications whose entitlements
 * come from the connector (ACCESS-P0-27). syncPipeline.ts runs it and records every step on the sync job.
 *
 * Steps run in order. A step that fails stops the chain: every later step
 * is recorded as skipped with the reason, and the chain is failed, never
 * succeeded (CLAUDE.md §17.5). Identities go first because accounts are
 * correlated to them.
 */

import type { SyncPipelineStatus, SyncPipelineStep, SyncPipelineStepStatus } from "@/lib/shared/types/integrations";

export type StepStatus = SyncPipelineStepStatus;
export type PipelineStatus = SyncPipelineStatus;
export type PipelineStep = SyncPipelineStep;

export type ImportOutcome = {
  mode: "full" | "incremental" | "partial";
  /** The job's import status (integration_sync_jobs.status). */
  status: "succeeded" | "partial" | "failed";
  /** The kinds the connection read, and those whose import threw. */
  kindsRead: string[];
  kindsFailed: string[];
};

/** The steps after an import, before anything runs; empty when nothing follows. */
export function planPipeline(
  outcome: ImportOutcome,
  sources: { id: string; name: string }[],
  applications: { id: string; name: string; entitlementsFromConnector?: boolean }[],
): PipelineStep[] {
  // An object-page import already applied its rows; nothing is promoted from a partial run.
  // An incremental run (INTEGRATION-P0-21) updated what changed; staging is still the whole
  // picture, so promotion and reconciliation from it stay correct (it marks nothing missing).
  if (outcome.mode === "partial") return [];
  const steps: PipelineStep[] = [];
  if (outcome.kindsRead.includes("identity")) {
    for (const s of sources) steps.push({ kind: "identities", targetId: s.id, name: s.name, status: "pending" });
  }
  if (outcome.kindsRead.includes("account")) {
    for (const a of applications) steps.push({ kind: "accounts", targetId: a.id, name: a.name, status: "pending" });
  }
  // ACCESS-P0-27: entitlements and grants last, since grants name accounts.
  if (outcome.kindsRead.includes("entitlement") || outcome.kindsRead.includes("access_grant")) {
    for (const a of applications) if (a.entitlementsFromConnector) steps.push({ kind: "access", targetId: a.id, name: a.name, status: "pending" });
  }
  if (outcome.status === "failed" || outcome.kindsFailed.length > 0) {
    const reason = outcome.status === "failed" ? "the import failed" : `the import of ${outcome.kindsFailed.join(", ")} failed`;
    return skipFrom(steps, 0, reason);
  }
  return steps;
}

/** Marks every step from `index` on as skipped with `reason`. */
export function skipFrom(steps: PipelineStep[], index: number, reason: string): PipelineStep[] {
  return steps.map((s, i) => (i >= index ? { ...s, status: "skipped" as const, reason } : s));
}

/**
 * The chain's status from its steps and the import's. Failed when a step
 * failed, the import failed, or no step ran at all; partial when some steps
 * were skipped (a source paused since the plan) or a step or the import was
 * partial; succeeded only when every step succeeded.
 */
export function pipelineStatusOf(steps: PipelineStep[], importStatus: ImportOutcome["status"]): PipelineStatus {
  if (steps.length === 0) return "none";
  if (steps.some((s) => s.status === "pending" || s.status === "running")) return "running";
  if (importStatus === "failed" || steps.some((s) => s.status === "failed") || steps.every((s) => s.status === "skipped")) return "failed";
  if (importStatus === "partial" || steps.some((s) => s.status === "partial" || s.status === "skipped")) return "partial";
  return "succeeded";
}
