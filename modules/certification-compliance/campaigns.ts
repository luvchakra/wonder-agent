import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { listAgents } from "@/modules/agent-identity/service";
import { getEffectiveAccess } from "@/modules/access-governance/service";
import { getFindings } from "@/modules/risk/service";
import { getDid } from "@/modules/runtime-assurance/service";
import type { CampaignCadence, CampaignScopeType, CertificationCampaign, CertificationItem } from "@/lib/shared/types/compliance";
import type { RiskSeverity } from "@/lib/shared/types/risk";
import { toCertificationCampaign, toCertificationItem } from "./mappers";

export type LaunchCampaignInput = {
  name: string;
  scopeType: CampaignScopeType;
  scope?: Record<string, unknown>;
  cadence: CampaignCadence;
  dueDate?: string;
  reviewerId: string;
};

const SEVERITY_RANK: Record<RiskSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * COMPLIANCE-P0-01.2's exact rule: "remove if usage_at_review = 'never'
 * AND risk is medium or above; review if risk is high/critical regardless
 * of usage; keep otherwise."
 */
export function computeRecommendation(riskAtReview: RiskSeverity | null, usageAtReview: "used" | "never" | "unknown") {
  const rank = riskAtReview ? SEVERITY_RANK[riskAtReview] : -1;
  if (rank >= SEVERITY_RANK.high) return "review" as const;
  if (usageAtReview === "never" && rank >= SEVERITY_RANK.medium) return "remove" as const;
  return "keep" as const;
}

/**
 * COMPLIANCE-P0-01.2. Only `scope_type: 'agent'` with a `criticality` array
 * in `scope` is implemented against a real filter in P0 — the other scope
 * types (application/entitlement/privileged_access/high_risk_agent) are
 * accepted by the schema's check constraint but not yet given their own
 * population logic; flagged rather than silently guessed, since the
 * backlog's only worked example is the criticality-scoped agent case.
 */
export async function launchCampaign(tenantId: string, actorId: string, input: LaunchCampaignInput): Promise<CertificationCampaign> {
  if (!input.name.trim()) throw new ApiError(400, "INVALID_INPUT", "name is required");

  const supabase = await supabaseServer();
  const { data: campaignRow, error: campaignError } = await supabase
    .from("certification_campaigns")
    .insert({
      tenant_id: tenantId,
      name: input.name,
      scope_type: input.scopeType,
      scope: input.scope ?? {},
      cadence: input.cadence,
      status: "active",
      due_date: input.dueDate ?? null,
      created_by: actorId,
    })
    .select()
    .single();
  if (campaignError || !campaignRow) throw new ApiError(500, "CREATE_FAILED", campaignError?.message ?? "Failed to create campaign");

  const campaign = toCertificationCampaign(campaignRow);

  if (input.scopeType === "agent") {
    const criticalities = Array.isArray(input.scope?.criticality) ? (input.scope!.criticality as string[]) : null;
    const agents = await listAgents(tenantId);
    const matching = criticalities ? agents.filter((a) => criticalities.includes(a.criticality)) : agents;

    const svc = supabaseServiceRole();
    for (const agent of matching) {
      const [effectiveAccess, findings, did] = await Promise.all([
        getEffectiveAccess(tenantId, agent.id),
        getFindings(tenantId, { agentId: agent.id, status: "open" }),
        getDid(tenantId, agent.id),
      ]);

      const worstFinding = findings.reduce<RiskSeverity | null>((worst, f) => {
        if (!worst || SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) return f.severity;
        return worst;
      }, null);

      for (const grant of effectiveAccess) {
        const usedResources = new Set(did.tuples.filter((t) => t.application === grant.application).map((t) => t.resource ?? t.application));
        const usageAtReview: "used" | "never" | "unknown" = did.tuples.length === 0 && findings.length === 0 ? "unknown" : usedResources.size > 0 ? "used" : "never";
        const recommendation = computeRecommendation(worstFinding, usageAtReview);

        const { error: itemError } = await svc.from("certification_items").insert({
          tenant_id: tenantId,
          campaign_id: campaign.id,
          agent_id: agent.id,
          access_grant_id: grant.id,
          reviewer_id: input.reviewerId,
          risk_at_review: worstFinding,
          usage_at_review: usageAtReview,
          recommendation,
          due_date: input.dueDate ?? null,
        });
        if (itemError) throw new ApiError(500, "CREATE_FAILED", itemError.message);
      }
    }
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "compliance.campaign_launched",
    objectType: "certification_campaign",
    objectId: campaign.id,
    outcome: "success",
    metadata: { scopeType: input.scopeType, scope: input.scope ?? {} },
  });

  return campaign;
}

export async function listCampaigns(tenantId: string): Promise<CertificationCampaign[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("certification_campaigns").select().eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toCertificationCampaign);
}

export async function listCampaignItems(tenantId: string, campaignId: string): Promise<CertificationItem[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("certification_items")
    .select()
    .eq("tenant_id", tenantId)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toCertificationItem);
}
