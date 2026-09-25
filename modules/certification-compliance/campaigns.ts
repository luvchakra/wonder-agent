import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import { getAgentContract, listAgents } from "@/modules/agent-identity/service";
import { getEffectiveAccess, listPolicyEvaluations, getApplication, getEntitlement } from "@/modules/access-governance/service";
import { getFindings } from "@/modules/risk/service";
import { getDid } from "@/modules/runtime-assurance/service";
import type { CampaignCadence, CampaignScopeType, CampaignMetrics, CertificationCampaign, CertificationItem } from "@/lib/shared/types/compliance";
import type { RiskSeverity } from "@/lib/shared/types/risk";
import { toCertificationCampaign, toCertificationItem } from "./mappers";
import { computeUsageForApplication, computeWorstSeverity, shapeCertificationSnapshot } from "./snapshot";
import { requireFeature } from "@/modules/platform-admin/service";

export type LaunchCampaignInput = {
  name: string;
  scopeType: CampaignScopeType;
  scope?: Record<string, unknown>;
  cadence: CampaignCadence;
  dueDate?: string;
  reviewerId: string;
};

// RISK-P0-02.2 added an `info` tier below `low` to RiskSeverity (Risk Agent's
// published contract); ranked below `low` here so this already-Done
// COMPLIANCE-P0-01.2 recommendation rule's behavior is unchanged for every
// pre-existing severity value.
const SEVERITY_RANK: Record<RiskSeverity, number> = { info: -1, low: 0, medium: 1, high: 2, critical: 3 };

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
 * Deterministic risk-band boundary already established by
 * `modules/risk/scoring.ts` (50-74 high, 75+ critical) — reused here, not
 * a new invented threshold, so `high_risk_agent` scope means exactly what
 * a risk finding at "high" severity already means elsewhere in this
 * codebase. `scope.minRiskScore` overrides it when a tenant wants a
 * stricter/looser cut.
 */
const HIGH_RISK_SCORE_THRESHOLD = 50;

/**
 * Shared by every `scope_type` below: one `certification_items` row per
 * (agent, effective-access grant) pair, optionally narrowed by
 * `grantFilter` (used by application/entitlement/privileged_access scopes
 * to certify only the grants relevant to that scope — an `agent`- or
 * `high_risk_agent`-scoped campaign has no grant-level filter, since the
 * scope already narrowed which *agents* are in it).
 */
async function populateCertificationItems(
  tenantId: string,
  campaignId: string,
  agents: { id: string }[],
  input: LaunchCampaignInput,
  grantFilter?: (grant: Awaited<ReturnType<typeof getEffectiveAccess>>[number]) => boolean,
): Promise<void> {
  const svc = supabaseServiceRole();
  for (const agent of agents) {
    const [contract, effectiveAccess, policyEvaluations, findings, did] = await Promise.all([
      getAgentContract(agent.id),
      getEffectiveAccess(tenantId, agent.id),
      listPolicyEvaluations(tenantId, agent.id),
      getFindings(tenantId, { agentId: agent.id, status: "open" }),
      getDid(tenantId, agent.id),
    ]);

    const worstFinding = computeWorstSeverity(findings);
    const grants = grantFilter ? effectiveAccess.filter(grantFilter) : effectiveAccess;

    for (const grant of grants) {
      const usageAtReview = computeUsageForApplication(did.tuples, findings.length > 0, grant.application);
      const recommendation = computeRecommendation(worstFinding, usageAtReview);
      // COMPLIANCE-P0-03 — snapshot everything the reviewer will see at
      // the moment this item is populated (contract/policy versions,
      // this specific grant, risk/usage) so a decision made later can be
      // reproduced exactly, even if the live contract/policy has since
      // changed.
      const snapshot = shapeCertificationSnapshot({ contract, grant, policyEvaluations, riskAtReview: worstFinding, usageAtReview });

      const { error: itemError } = await svc.from("certification_items").insert({
        tenant_id: tenantId,
        campaign_id: campaignId,
        agent_id: agent.id,
        access_grant_id: grant.id,
        reviewer_id: input.reviewerId,
        risk_at_review: worstFinding,
        usage_at_review: usageAtReview,
        recommendation,
        due_date: input.dueDate ?? null,
        snapshot,
      });
      if (itemError) throw new ApiError(500, "CREATE_FAILED", itemError.message);
    }
  }
}

/**
 * COMPLIANCE-P0-01.2. All five `scope_type`s populate real items:
 * - `agent` — optionally narrowed by `scope.criticality` (an array).
 * - `application` — every agent's grants on `scope.applicationId`.
 * - `entitlement` — every agent's grants of `scope.entitlementId`.
 * - `privileged_access` — every agent's grants whose entitlement is
 *   `elevated`/`admin` privilege level.
 * - `high_risk_agent` — every agent whose current `agents.risk_score` (set
 *   by Risk Agent's `evaluateAgentRisk()`) is at/above `scope.minRiskScore`
 *   or the `high` severity band default; all of that agent's grants.
 * Scope input is validated before the campaign row is created, so an
 * invalid scope never leaves behind an empty, orphaned campaign.
 */
export async function launchCampaign(tenantId: string, actorId: string, input: LaunchCampaignInput): Promise<CertificationCampaign> {
  // PLATFORM-P0-12: certification campaigns are a flag-gated capability (on by default).
  await requireFeature(tenantId, "certifications");
  if (!input.name.trim()) throw new ApiError(400, "INVALID_INPUT", "name is required");

  let applicationId: string | null = null;
  let entitlementId: string | null = null;
  if (input.scopeType === "application") {
    applicationId = typeof input.scope?.applicationId === "string" ? input.scope.applicationId : null;
    if (!applicationId) throw new ApiError(400, "INVALID_INPUT", "scope.applicationId is required for scope_type 'application'");
    if (!(await getApplication(tenantId, applicationId))) throw new ApiError(404, "APPLICATION_NOT_FOUND");
  } else if (input.scopeType === "entitlement") {
    entitlementId = typeof input.scope?.entitlementId === "string" ? input.scope.entitlementId : null;
    if (!entitlementId) throw new ApiError(400, "INVALID_INPUT", "scope.entitlementId is required for scope_type 'entitlement'");
    if (!(await getEntitlement(tenantId, entitlementId))) throw new ApiError(404, "ENTITLEMENT_NOT_FOUND");
  }

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
    await populateCertificationItems(tenantId, campaign.id, matching, input);
  } else if (input.scopeType === "application") {
    const agents = await listAgents(tenantId);
    await populateCertificationItems(tenantId, campaign.id, agents, input, (grant) => grant.applicationId === applicationId);
  } else if (input.scopeType === "entitlement") {
    const agents = await listAgents(tenantId);
    await populateCertificationItems(tenantId, campaign.id, agents, input, (grant) => grant.entitlementId === entitlementId);
  } else if (input.scopeType === "privileged_access") {
    const agents = await listAgents(tenantId);
    await populateCertificationItems(tenantId, campaign.id, agents, input, (grant) => grant.privilegeLevel === "elevated" || grant.privilegeLevel === "admin");
  } else if (input.scopeType === "high_risk_agent") {
    const threshold = typeof input.scope?.minRiskScore === "number" ? (input.scope.minRiskScore as number) : HIGH_RISK_SCORE_THRESHOLD;
    const agents = (await listAgents(tenantId)).filter((a) => a.riskScore !== null && a.riskScore >= threshold);
    await populateCertificationItems(tenantId, campaign.id, agents, input);
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
  const { data, error } = await supabase.from("certification_campaigns").select().eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(DEFAULT_LIST_LIMIT);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toCertificationCampaign);
}

/**
 * Deliberately NOT given a `DEFAULT_LIST_LIMIT` cap (unlike most other
 * `list*()` functions touched in the 2026-09-16 pagination pass):
 * `getCampaignMetrics()` below and `export.ts`'s evidence export both
 * depend on this returning every item to compute correct
 * totals/percentages and a complete compliance evidence artifact — a
 * silent truncation here would be a correctness/compliance-integrity bug,
 * not just a performance one. Revisit with real keyset pagination for the
 * campaign-detail *page's* item table specifically (a separate concern
 * from this function's aggregate-computation callers) if item counts ever
 * become a real problem.
 */
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

/**
 * COMPLIANCE-P0-05 — "a campaign's summary reports its count of overdue/
 * escalated items." `overdueItems` counts every still-pending item whose
 * due_date has passed, whether or not it has been escalated yet;
 * `escalatedItems` counts items `escalateOverdueItems()` (escalation.ts)
 * has already processed.
 */
export async function getCampaignMetrics(tenantId: string, campaignId: string): Promise<CampaignMetrics> {
  const items = await listCampaignItems(tenantId, campaignId);
  const now = Date.now();
  return {
    totalItems: items.length,
    pendingItems: items.filter((i) => i.status === "pending").length,
    decidedItems: items.filter((i) => i.status === "decided").length,
    overdueItems: items.filter((i) => i.status === "pending" && i.dueDate && new Date(i.dueDate).getTime() < now).length,
    escalatedItems: items.filter((i) => i.escalatedAt !== null).length,
  };
}
