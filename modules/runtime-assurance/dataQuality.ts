import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RuntimeDataQualityMetrics } from "@/lib/shared/types/runtime";

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * RUNTIME-P0-14 — Runtime Data Quality Tracking. A real aggregate query
 * over runtime_events (runtime_events grants a client-facing SELECT
 * policy, so this runs as the calling user) rather than a separate stored
 * table — "queryable" is satisfied by an on-demand aggregate; a
 * materialized table would need its own refresh/staleness story that
 * isn't part of this P0 acceptance criteria. "Missing identity mapping"
 * counts events with no resolved identity_id; "unknown resource" counts
 * events where the application and/or the specific resource couldn't be
 * attributed at all (never silently treated as a fully-resolved event).
 */
export async function getDataQualityMetrics(
  tenantId: string,
  agentId?: string,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<RuntimeDataQualityMetrics> {
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  const windowEnd = new Date().toISOString();

  const supabase = await supabaseServer();
  let base = supabase.from("runtime_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("event_time", windowStart);
  if (agentId) base = base.eq("agent_id", agentId);
  const { count: totalEvents, error: totalError } = await base;
  if (totalError) throw new ApiError(500, "QUERY_FAILED", totalError.message);

  let missingIdentity = supabase
    .from("runtime_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("event_time", windowStart)
    .is("identity_id", null);
  if (agentId) missingIdentity = missingIdentity.eq("agent_id", agentId);
  const { count: missingIdentityCount, error: identityError } = await missingIdentity;
  if (identityError) throw new ApiError(500, "QUERY_FAILED", identityError.message);

  let unknownResource = supabase
    .from("runtime_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("event_time", windowStart)
    .or("application.is.null,resource.is.null");
  if (agentId) unknownResource = unknownResource.eq("agent_id", agentId);
  const { count: unknownResourceCount, error: resourceError } = await unknownResource;
  if (resourceError) throw new ApiError(500, "QUERY_FAILED", resourceError.message);

  return {
    tenantId,
    agentId: agentId ?? null,
    windowStart,
    windowEnd,
    totalEvents: totalEvents ?? 0,
    missingIdentityCount: missingIdentityCount ?? 0,
    unknownResourceCount: unknownResourceCount ?? 0,
  };
}
