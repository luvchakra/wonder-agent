import "server-only";

import { after } from "next/server";

import { getTenantConfig } from "@/lib/config/tenantConfig";
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
const AGENT_BATCH = 16;

async function populateCertificationItems(
  tenantId: string,
  campaignId: string,
  agents: { id: string }[],
  input: LaunchCampaignInput,
  grantFilter?: (grant: Awaited<ReturnType<typeof getEffectiveAccess>>[number]) => boolean,
): Promise<number> {
  const svc = supabaseServiceRole();
  // Agents are read AGENT_BATCH at a time and the items written in bulk:
  // one agent after another made a launch take about half a second per
  // agent (28 s for 56), past what a person waits for (§15).
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < agents.length; i += AGENT_BATCH) {
    const batch = await Promise.all(
      agents.slice(i, i + AGENT_BATCH).map(async (agent) => {
        const [contract, effectiveAccess, policyEvaluations, findings, did] = await Promise.all([
          getAgentContract(agent.id, tenantId),
          getEffectiveAccess(tenantId, agent.id),
          listPolicyEvaluations(tenantId, agent.id),
          getFindings(tenantId, { agentId: agent.id, status: "open" }),
          getDid(tenantId, agent.id),
        ]);
        const worstFinding = computeWorstSeverity(findings);
        const grants = grantFilter ? effectiveAccess.filter(grantFilter) : effectiveAccess;
        return grants.map((grant) => {
          const usageAtReview = computeUsageForApplication(did.tuples, findings.length > 0, grant.application);
          const recommendation = computeRecommendation(worstFinding, usageAtReview);
          // COMPLIANCE-P0-03 — snapshot everything the reviewer will see at
          // the moment this item is populated (contract/policy versions,
          // this specific grant, risk/usage) so a decision made later can be
          // reproduced exactly, even if the live contract/policy has since
          // changed.
          const snapshot = shapeCertificationSnapshot({ contract, grant, policyEvaluations, riskAtReview: worstFinding, usageAtReview });
          return {
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
          };
        });
      }),
    );
    for (const items of batch) rows.push(...items);
  }
  // Everything is read first and written last, so a failed read writes nothing.
  for (let i = 0; i < rows.length; i += 500) {
    const { error: itemError } = await svc.from("certification_items").insert(rows.slice(i, i + 500));
    if (itemError) throw new ApiError(500, "CREATE_FAILED", itemError.message);
  }
  return rows.length;
}

type ScopeTargets = { agents: { id: string }[]; grantFilter?: Parameters<typeof populateCertificationItems>[4] };

/** The agents (and, for some scopes, the grants) a campaign covers. */
async function scopeTargets(tenantId: string, input: LaunchCampaignInput, ids: { applicationId: string | null; entitlementId: string | null }): Promise<ScopeTargets> {
  if (input.scopeType === "agent") {
    const criticalities = Array.isArray(input.scope?.criticality) ? (input.scope!.criticality as string[]) : null;
    const agents = await listAgents(tenantId);
    return { agents: criticalities ? agents.filter((a) => criticalities.includes(a.criticality)) : agents };
  }
  if (input.scopeType === "application") return { agents: await listAgents(tenantId), grantFilter: (grant) => grant.applicationId === ids.applicationId };
  if (input.scopeType === "entitlement") return { agents: await listAgents(tenantId), grantFilter: (grant) => grant.entitlementId === ids.entitlementId };
  if (input.scopeType === "privileged_access") return { agents: await listAgents(tenantId), grantFilter: (grant) => grant.privilegeLevel === "elevated" || grant.privilegeLevel === "admin" };
  if (input.scopeType === "high_risk_agent") {
    // The campaign's own threshold, else the organization's (Global Configuration), else HIGH_RISK_SCORE_THRESHOLD.
    const threshold =
      typeof input.scope?.minRiskScore === "number"
        ? (input.scope.minRiskScore as number)
        : ((await getTenantConfig(tenantId))["certification.highRiskScore"] ?? HIGH_RISK_SCORE_THRESHOLD);
    return { agents: (await listAgents(tenantId)).filter((a) => a.riskScore !== null && a.riskScore >= threshold) };
  }
  return { agents: [] };
}

/** A build error as it may be shown and stored: short, and never a stack or a secret. */
function buildErrorText(err: unknown): string {
  return err instanceof ApiError ? err.message.slice(0, 300) : "The items could not be built. Launch the campaign again.";
}

/**
 * §15: builds a launched campaign's items after the response has gone, then
 * marks it ready with its count. On failure it removes any undecided items
 * it wrote and marks the campaign failed with the reason, so a reviewer
 * never works from a half-built campaign. Service role for the status and
 * clean-up, pinned to the tenant (§14). Audited either way (#11).
 */
async function buildCampaign(tenantId: string, actorId: string, campaignId: string, input: LaunchCampaignInput, ids: { applicationId: string | null; entitlementId: string | null }): Promise<void> {
  const svc = supabaseServiceRole();
  try {
    const { agents, grantFilter } = await scopeTargets(tenantId, input, ids);
    const total = await populateCertificationItems(tenantId, campaignId, agents, input, grantFilter);
    const { error } = await svc
      .from("certification_campaigns")
      .update({ build_status: "ready", items_total: total, built_at: new Date().toISOString(), build_error: null })
      .eq("tenant_id", tenantId)
      .eq("id", campaignId)
      .eq("build_status", "building");
    if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
    await writeAudit({ tenantId, actorId, actorType: "user", action: "compliance.campaign_built", objectType: "certification_campaign", objectId: campaignId, outcome: "success", metadata: { items: total } });
  } catch (err) {
    const message = buildErrorText(err);
    await failCampaignBuild(tenantId, campaignId, message);
    await writeAudit({ tenantId, actorId, actorType: "user", action: "compliance.campaign_built", objectType: "certification_campaign", objectId: campaignId, outcome: "failure", metadata: { error: message } });
  }
}

/** Marks a build failed and removes the undecided items it wrote (decided ones are evidence and stay). */
async function failCampaignBuild(tenantId: string, campaignId: string, message: string): Promise<void> {
  const svc = supabaseServiceRole();
  await svc.from("certification_items").delete().eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "pending");
  await svc.from("certification_campaigns").update({ build_status: "failed", build_error: message.slice(0, 500) }).eq("tenant_id", tenantId).eq("id", campaignId).eq("build_status", "building");
}

/**
 * §15: a build that never finished (the process ended, say) is failed after
 * BUILD_TIMEOUT_MINUTES, so the campaign does not say "building" forever.
 * For the compliance cron; each write is pinned to the row's own tenant.
 */
export const BUILD_TIMEOUT_MINUTES = 15;
export async function failStaleCampaignBuilds(now = new Date()): Promise<number> {
  const svc = supabaseServiceRole();
  const cutoff = new Date(now.getTime() - BUILD_TIMEOUT_MINUTES * 60_000).toISOString();
  const { data, error } = await svc.from("certification_campaigns").select("id, tenant_id").eq("build_status", "building").lt("created_at", cutoff).limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  for (const c of data ?? []) {
    await failCampaignBuild(c.tenant_id as string, c.id as string, "The build was interrupted. Launch the campaign again.");
    await writeAudit({ tenantId: c.tenant_id as string, actorType: "system", action: "compliance.campaign_built", objectType: "certification_campaign", objectId: c.id as string, outcome: "failure", metadata: { error: "interrupted" } });
  }
  return data?.length ?? 0;
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
      build_status: "building",
    })
    .select()
    .single();
  if (campaignError || !campaignRow) throw new ApiError(500, "CREATE_FAILED", campaignError?.message ?? "Failed to create campaign");

  const campaign = toCertificationCampaign(campaignRow);

  // §15: the items are built after the response, so a large organization's launch returns at once.
  after(() => buildCampaign(tenantId, actorId, campaign.id, input, { applicationId, entitlementId }));

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

/** One campaign of the tenant, or null. */
export async function getCampaign(tenantId: string, campaignId: string): Promise<CertificationCampaign | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("certification_campaigns").select().eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toCertificationCampaign(data) : null;
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
 * has already processed. Counted in the database (campaign_item_counts,
 * migration 0154), never by reading every item (§15).
 */
export async function getCampaignMetrics(tenantId: string, campaignId: string): Promise<CampaignMetrics> {
  const counts = await campaignItemCounts(tenantId, campaignId);
  return counts.get(campaignId) ?? { totalItems: 0, pendingItems: 0, decidedItems: 0, overdueItems: 0, escalatedItems: 0 };
}

/** §15: item counts for one campaign or every campaign of the tenant, in one query. */
export async function campaignItemCounts(tenantId: string, campaignId?: string): Promise<Map<string, CampaignMetrics>> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("campaign_item_counts", { p_tenant: tenantId, p_campaign: campaignId ?? null });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const out = new Map<string, CampaignMetrics>();
  for (const r of (data ?? []) as { campaign_id: string; total: number; pending: number; decided: number; overdue: number; escalated: number }[]) {
    out.set(r.campaign_id, { totalItems: Number(r.total), pendingItems: Number(r.pending), decidedItems: Number(r.decided), overdueItems: Number(r.overdue), escalatedItems: Number(r.escalated) });
  }
  return out;
}

const ITEM_SORTS = { status: "status", riskAtReview: "risk_at_review", recommendation: "recommendation", agentId: "agent_id" } as const;
const ITEM_WORDS = ["pending", "decided", "keep", "review", "remove", "used", "never", "unknown"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * §15: one page of a campaign's items, paged, sorted and filtered in the
 * database. Sorting only by known columns; the filter matches a known word
 * (a status, recommendation or usage) or an agent id, so typed text never
 * reaches a query string (§18.3 #8).
 */
export async function listCampaignItemsPage(
  tenantId: string,
  campaignId: string,
  opts: { page?: number; pageSize?: number; sortKey?: string | null; sortDir?: "asc" | "desc"; q?: string },
): Promise<{ rows: CertificationItem[]; total: number }> {
  const pageSize = Math.min(Math.max(Math.trunc(opts.pageSize ?? 25) || 25, 1), 200);
  const page = Math.max(Math.trunc(opts.page ?? 1) || 1, 1);
  const supabase = await supabaseServer();
  let query = supabase.from("certification_items").select("*", { count: "exact" }).eq("tenant_id", tenantId).eq("campaign_id", campaignId);
  const q = (opts.q ?? "").trim().toLowerCase();
  if (q) {
    if (UUID_RE.test(q)) query = query.eq("agent_id", q);
    else if ((ITEM_WORDS as readonly string[]).includes(q)) query = q === "pending" || q === "decided" ? query.eq("status", q) : ["used", "never", "unknown"].includes(q) ? query.eq("usage_at_review", q) : query.eq("recommendation", q);
    else return { rows: [], total: 0 };
  }
  const sortColumn = opts.sortKey && opts.sortKey in ITEM_SORTS ? ITEM_SORTS[opts.sortKey as keyof typeof ITEM_SORTS] : "status";
  const { data, error, count } = await query
    .order(sortColumn, { ascending: (opts.sortDir ?? "asc") === "asc" })
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return { rows: (data ?? []).map(toCertificationItem), total: count ?? 0 };
}
