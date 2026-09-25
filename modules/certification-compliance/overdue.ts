import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * RISK-P0-12 — published for the Risk engine's "Certification overdue"
 * factor, which had no source until now. Counts this agent's certification
 * items still pending past their due date. Reads as the calling user
 * under RLS, with the tenant filtered explicitly (§14). Deterministic: the
 * same rule `escalateOverdueItems()` uses for "overdue" (pending and
 * `due_date` in the past), escalated or not.
 */
export async function countOverdueCertificationItems(tenantId: string, agentId: string): Promise<number> {
  const supabase = await supabaseServer();
  const { count, error } = await supabase
    .from("certification_items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .eq("status", "pending")
    .lt("due_date", new Date().toISOString());
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return count ?? 0;
}
