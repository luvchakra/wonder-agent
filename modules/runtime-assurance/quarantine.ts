import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RuntimeEventQuarantineEntry } from "@/lib/shared/types/runtime";
import { toRuntimeEventQuarantineEntry } from "./mappers";

/**
 * RUNTIME-P0-11 — records an event that failed schema/replay-window
 * validation instead of silently dropping it, so an administrator or
 * Integration Agent can investigate a misbehaving source. Stores only
 * safe, non-secret-leaking fields (source/action/submitted event time/
 * attempted dedupe key) — never the full raw payload, which could carry
 * sensitive request data from an untrusted or malicious submitter.
 * Evidentiary data — service-role write, client SELECT only (migration
 * 0043), same pattern as risk_findings.
 */
export async function quarantineEvent(
  tenantId: string,
  reason: string,
  details: {
    agentId?: string | null;
    source?: string | null;
    action?: string | null;
    submittedEventTime?: string | null;
    attemptedDedupeKey?: string | null;
  },
): Promise<RuntimeEventQuarantineEntry> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("runtime_event_quarantine")
    .insert({
      tenant_id: tenantId,
      agent_id: details.agentId ?? null,
      reason,
      source: details.source ?? null,
      action: details.action ?? null,
      submitted_event_time: details.submittedEventTime ?? null,
      attempted_dedupe_key: details.attemptedDedupeKey ?? null,
    })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to quarantine event");

  await writeAudit({
    tenantId,
    actorId: null,
    actorType: "system",
    action: "runtime.event_quarantined",
    objectType: "runtime_event_quarantine",
    objectId: data.id,
    outcome: "success",
    metadata: { reason, source: details.source, action: details.action },
  });

  return toRuntimeEventQuarantineEntry(data);
}

export async function listQuarantinedEvents(tenantId: string): Promise<RuntimeEventQuarantineEntry[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("runtime_event_quarantine")
    .select()
    .eq("tenant_id", tenantId)
    .order("received_at", { ascending: false })
    .limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toRuntimeEventQuarantineEntry);
}
