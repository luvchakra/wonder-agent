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
};

export type KindDecision = { complete: true } | { complete: false; reason: string };

/** Whether a run read a kind completely enough to mark what it did not see. */
export function kindCompleteness(mode: SyncMode, run: KindRun): KindDecision {
  if (mode !== "full") return { complete: false, reason: mode === "partial" ? "partial run" : "incremental run" };
  if (run.failed) return { complete: false, reason: "the import of this kind failed" };
  if (run.unread) return { complete: false, reason: "nothing was read (no new file)" };
  if (run.truncated) return { complete: false, reason: "the read stopped at a limit" };
  if (run.storeFailures > 0) return { complete: false, reason: `${run.storeFailures} records could not be stored` };
  if (run.unmapped > 0) return { complete: false, reason: "some records could not be mapped" };
  return { complete: true };
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

/** Kinds still held in a summary (what an approve or discard decides). */
export function heldKinds(summary: MissingSummary): string[] {
  return Object.entries(summary)
    .filter(([, k]) => k.status === "held")
    .map(([kind]) => kind);
}
