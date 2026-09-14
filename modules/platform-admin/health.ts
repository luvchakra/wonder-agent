import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import type { PlatformHealth, PlatformHealthSignal } from "@/lib/shared/types/platform";

/**
 * PLATFORM-P0-03.2. Reads real signals where already available; shows
 * "not_instrumented" where a signal's source doesn't exist yet, rather
 * than fabricating a number, per the backlog's explicit instruction.
 */
export async function getPlatformHealth(): Promise<PlatformHealth> {
  const supabase = supabaseServiceRole();
  const signals: PlatformHealthSignal[] = [];

  const { error: dbError } = await supabase.from("tenants").select("id").limit(1);
  signals.push(dbError ? { name: "Database reachability", status: "degraded", detail: dbError.message } : { name: "Database reachability", status: "ok" });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: totalAudit, error: auditTotalError } = await supabase.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", since);
  const { count: failedAudit, error: auditFailedError } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    .eq("outcome", "failure");
  if (auditTotalError || auditFailedError) {
    signals.push({ name: "API error rate (24h)", status: "not_instrumented", detail: "audit_logs query failed" });
  } else {
    const total = totalAudit ?? 0;
    const failed = failedAudit ?? 0;
    const rate = total > 0 ? (failed / total) * 100 : 0;
    signals.push({
      name: "API error rate (24h)",
      status: rate > 5 ? "degraded" : "ok",
      detail: `${failed}/${total} audited actions failed (${rate.toFixed(1)}%)`,
    });
  }

  const { count: failedSyncJobs, error: syncError } = await supabase
    .from("integration_sync_jobs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    .eq("status", "failed");
  signals.push(
    syncError
      ? { name: "Integration sync failures (24h)", status: "not_instrumented", detail: "integration_sync_jobs unavailable" }
      : { name: "Integration sync failures (24h)", status: (failedSyncJobs ?? 0) > 0 ? "degraded" : "ok", detail: `${failedSyncJobs ?? 0} failed job(s)` },
  );

  // Signals with no source module yet in this build order.
  signals.push({ name: "Runtime event ingestion lag", status: "not_instrumented" });
  signals.push({ name: "Background job queue depth", status: "not_instrumented", detail: "no queue infrastructure exists (next/server after() is fire-and-forget, not observable)" });

  return { signals, checkedAt: new Date().toISOString() };
}
