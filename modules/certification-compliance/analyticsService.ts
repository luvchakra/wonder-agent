import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { DecisionCount } from "./analytics";

/**
 * COMPLIANCE-P0-10 (remainder) — the counts behind the campaign analytics,
 * from the database (migration 0199) as the user under RLS, with the
 * session's tenant passed explicitly (§14).
 */

export async function listCampaignDecisionCounts(tenantId: string): Promise<DecisionCount[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("campaign_decision_counts", { p_tenant: tenantId });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as { campaign_id: string; decision: string; decisions: number; avg_hours: number | null }[]).map((r) => ({
    campaignId: r.campaign_id,
    decision: r.decision,
    decisions: Number(r.decisions),
    avgHours: r.avg_hours === null ? null : Number(r.avg_hours),
  }));
}

export type ReviewerBacklog = { reviewerId: string; name: string; pending: number; overdue: number };

/** Reviewers with open items in active campaigns, most overdue first (at most 20). */
export async function listReviewerBacklog(tenantId: string): Promise<ReviewerBacklog[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("campaign_reviewer_backlog", { p_tenant: tenantId });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (data ?? []) as { reviewer_id: string; pending: number; overdue: number }[];
  const names = new Map<string, string>();
  if (rows.length) {
    // users is global (no tenant_id); only the reviewers this tenant's own items name are looked up, for their names.
    const { data: people } = await supabaseServiceRole().from("users").select("id, email, display_name").in("id", rows.map((r) => r.reviewer_id));
    for (const p of (people ?? []) as { id: string; email: string | null; display_name: string | null }[]) names.set(p.id, p.display_name || p.email || "A former member");
  }
  return rows.map((r) => ({ reviewerId: r.reviewer_id, name: names.get(r.reviewer_id) ?? "A former member", pending: Number(r.pending), overdue: Number(r.overdue) }));
}
