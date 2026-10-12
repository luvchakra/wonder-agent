/**
 * INTEGRATION-P0-18 — staging reflects the source. Pure rules (no I/O) for
 * when a sync may mark staged objects missing at the source, and how the
 * job records what it decided. The marking itself is stage_mark_missing()
 * (migration 0117), called by runSyncJob().
 *
 * The safe direction is always "do not mark": an object wrongly marked
 * missing turns a present account into a removed one downstream (a leaver,
 * a revoked grant), while an object wrongly left present only waits for the
 * next complete run.
 */

export type SyncMode = "full" | "incremental" | "partial";
export type MissingStatus = "none" | "applied" | "held" | "approved" | "discarded";

/** What one kind's import did in a run. */
export type KindRun = {
  /** The import of this kind threw. */
  failed: boolean;
  /** Rows of this kind that could not be stored. */
  storeFailures: number;
  /** Records of this kind the definition could not map (never stored). */
  unmapped: number;
  /** The engine's read report (FetchReport). */
  truncated: boolean;
  unread: boolean;
  /** WID-H03: fewer records than the system said it holds. */
  short?: boolean;
};

export type KindDecision = { complete: true } | { complete: false; reason: string };

/** Whether a run read a kind completely enough to mark what it did not see. */
export function kindCompleteness(mode: SyncMode, run: KindRun): KindDecision {
  if (mode !== "full") return { complete: false, reason: mode === "partial" ? "partial run" : "incremental run" };
  if (run.failed) return { complete: false, reason: "the import of this kind failed" };
  if (run.unread) return { complete: false, reason: "nothing was read (no new file)" };
  if (run.truncated) return { complete: false, reason: "the read stopped at a limit" };
  if (run.short) return { complete: false, reason: "fewer records were read than the system reported" };
  if (run.storeFailures > 0) return { complete: false, reason: `${run.storeFailures} records could not be stored` };
  if (run.unmapped > 0) return { complete: false, reason: "some records could not be mapped" };
  return { complete: true };
}

/**
 * WID-H03: a run's status. Any error makes it partial (or failed when
 * nothing was stored). A run in which a kind's read stopped at a limit is
 * partial too, even without errors: only a succeeded run is a base for the
 * next incremental read (its cursor) and for the daily full read, so a
 * cut-short run must never move either.
 */
export function runStatus(errorCount: number, recordsProcessed: number, kindRuns: Iterable<KindRun>): "succeeded" | "partial" | "failed" {
  if (errorCount > 0) return recordsProcessed > 0 ? "partial" : "failed";
  for (const run of kindRuns) if (run.truncated || run.short) return "partial";
  return "succeeded";
}

/** One kind's outcome, as stored in integration_sync_jobs.missing_summary. */
export type KindMissing =
  | { status: "marked"; marked: number; candidates: number; presentBefore: number }
  | { status: "held"; candidates: number; presentBefore: number; thresholdPercent: number }
  | { status: "skipped"; reason: string }
  | { status: "approved"; marked: number; candidates: number; presentBefore: number }
  | { status: "discarded"; candidates: number; presentBefore: number };

export type MissingSummary = Record<string, KindMissing>;

/** The job-level status from its kinds: any held kind holds the run. */
export function missingStatusOf(summary: MissingSummary): MissingStatus {
  const outcomes = Object.values(summary);
  if (outcomes.some((k) => k.status === "held")) return "held";
  if (outcomes.some((k) => k.status === "marked" && k.marked > 0)) return "applied";
  return "none";
}

/** Objects of a kind below this many present are never held: removing a few of a few is not a mass change. */
export const MASS_MISSING_MIN_POPULATION = 20;

/**
 * WID-H03: people marked missing become leavers, so a sync holds earlier
 * for identities: at most this share, whatever the organization's setting.
 */
export const IDENTITY_MASS_MISSING_CAP = 10;

/** The mass-missing threshold for one kind: the organization's, capped for identities. */
export function massMissingThreshold(kind: string, organizationPercent: number): number {
  return kind === "identity" ? Math.min(organizationPercent, IDENTITY_MASS_MISSING_CAP) : organizationPercent;
}

/** Kinds still held in a summary (what an approve or discard decides). */
export function heldKinds(summary: MissingSummary): string[] {
  return Object.entries(summary)
    .filter(([, k]) => k.status === "held")
    .map(([kind]) => kind);
}

// ------------------------------------------------- INTEGRATION-P0-21

/** An incremental run reads from a little before the last good run started, so clock skew loses nothing. */
export const INCREMENTAL_OVERLAP_MS = 5 * 60_000;
/** Deletions show only in a full read, so a connection reads in full at least this often. */
export const FULL_RUN_EVERY_MS = 24 * 3_600_000;

export type RunModeInput = {
  /** What the job was created as (a person may ask for incremental over the API). */
  requested: SyncMode;
  trigger: string;
  /** The definition has a `changes` request on some resource. */
  supportsIncremental: boolean;
  /** When the connection's last successful run (full or incremental) started. */
  lastSucceededStart: string | null;
  /** When its last successful full run started. */
  lastFullSucceededStart: string | null;
  now: Date;
};

/**
 * INTEGRATION-P0-21: whether a run reads only what changed. A scheduled run
 * (or one asked for as incremental) is incremental when the definition can
 * read changes, a run has succeeded before (the cursor), and a full run
 * succeeded within a day; otherwise it reads in full. Every other run (sync
 * now, a verification after a write) is full: verifying a removal needs to
 * see the whole list.
 */
export function chooseRunMode(input: RunModeInput): { mode: SyncMode; since: Date | null; reason?: string } {
  if (input.requested === "partial") return { mode: "partial", since: null };
  const wantsIncremental = input.requested === "incremental" || input.trigger === "scheduled";
  if (!wantsIncremental) return { mode: "full", since: null };
  if (!input.supportsIncremental) return { mode: "full", since: null, reason: "the connection type cannot read only changes" };
  if (!input.lastSucceededStart || !input.lastFullSucceededStart) return { mode: "full", since: null, reason: "no earlier successful full run" };
  if (input.now.getTime() - Date.parse(input.lastFullSucceededStart) > FULL_RUN_EVERY_MS) return { mode: "full", since: null, reason: "the daily full run is due" };
  return { mode: "incremental", since: new Date(Date.parse(input.lastSucceededStart) - INCREMENTAL_OVERLAP_MS) };
}
