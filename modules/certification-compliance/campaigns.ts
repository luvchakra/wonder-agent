import "server-only";

import { after } from "next/server";

import { getTenantConfig } from "@/lib/config/tenantConfig";
import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import { getAgentContract, listAgents } from "@/modules/agent-identity/service";
import { getEffectiveAccess, listPolicyEvaluations, getApplication, getEntitlement, listIdentityGrantsForReview, listPackagesForReview } from "@/modules/access-governance/service";
import { getHumanIdentityIdsForUsers, getIdentityReviewInfo } from "@/modules/agent-identity/service";
import { listRoleAssignmentsForReview } from "@/lib/rbac/roleAssignmentReview";
import { REVIEWER_KINDS, resolveReviewer, type ReviewerKind } from "./identityReviewRules";
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
  /** COMPLIANCE-P0-10: for scope 'identity_access', who reviews each item (the named reviewer is the fallback). */
  reviewerKind?: ReviewerKind;
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

type ItemRow = Record<string, unknown>;

async function buildAgentItems(
  tenantId: string,
  campaignId: string,
  agents: { id: string }[],
  input: LaunchCampaignInput,
  grantFilter?: (grant: Awaited<ReturnType<typeof getEffectiveAccess>>[number]) => boolean,
): Promise<ItemRow[]> {
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
  return rows;
}

/** Everything is read first and written last, so a failed read writes nothing. */
async function insertItems(rows: ItemRow[]): Promise<number> {
  const svc = supabaseServiceRole();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await svc.from("certification_items").insert(rows.slice(i, i + 500));
    if (error) throw new ApiError(500, "CREATE_FAILED", error.message);
  }
  return rows.length;
}

type ScopeTargets = { agents: { id: string }[]; grantFilter?: Parameters<typeof buildAgentItems>[4] };

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

/**
 * COMPLIANCE-P0-10: a people's-access campaign has one item per live grant
 * on an account linked to a person, contractor or service account
 * (optionally one application, or privileged access only). Each item goes
 * to the identity's manager, the application's owner or the named
 * reviewer, never to the person whose access it is, and keeps a snapshot
 * of what the reviewer is shown.
 */
async function buildIdentityItems(tenantId: string, campaignId: string, input: LaunchCampaignInput, applicationId: string | null): Promise<ItemRow[]> {
  const grants = await listIdentityGrantsForReview(tenantId, { applicationId, privilegedOnly: input.scope?.privilegedOnly === true });
  const ids = [...new Set(grants.flatMap((g) => [g.identityId, g.applicationOwnerIdentityId].filter((x): x is string => Boolean(x))))];
  const info = await getIdentityReviewInfo(tenantId, ids);
  const managers = await getIdentityReviewInfo(tenantId, [...new Set([...info.values()].map((p) => p.managerIdentityId).filter((x): x is string => Boolean(x)))]);
  const kind = input.reviewerKind ?? "named";
  const now = new Date().toISOString();
  const rows = grants.map((g) => {
    const person = info.get(g.identityId);
    const managerId = person?.managerIdentityId ?? null;
    const reviewer = resolveReviewer(
      kind,
      {
        subjectUserId: person?.userId ?? null,
        managerUserId: managerId ? (managers.get(managerId)?.userId ?? info.get(managerId)?.userId ?? null) : null,
        applicationOwnerUserId: g.applicationOwnerIdentityId ? (info.get(g.applicationOwnerIdentityId)?.userId ?? null) : null,
      },
      input.reviewerId,
    );
    return {
      tenant_id: tenantId,
      campaign_id: campaignId,
      identity_id: g.identityId,
      account_id: g.accountId,
      access_grant_id: g.grantId,
      reviewer_id: reviewer.reviewerId,
      risk_at_review: g.privilegeLevel === "admin" || g.privilegeLevel === "elevated" ? "high" : null,
      usage_at_review: "unknown",
      recommendation: g.privilegeLevel === "admin" || g.privilegeLevel === "elevated" ? "review" : "keep",
      due_date: input.dueDate ?? null,
      snapshot: {
        capturedAt: now,
        agentContractId: null,
        agentContractVersion: null,
        accessGrant: { id: g.grantId, application: g.applicationName, entitlementName: g.entitlementName },
        policyEvaluations: [],
        riskAtReview: null,
        usageAtReview: "unknown",
        person: { id: g.identityId, displayName: person?.displayName ?? "Unknown identity", identityType: person?.identityType ?? "HUMAN" },
        account: { id: g.accountId, ref: g.accountRef },
        privilegeLevel: g.privilegeLevel,
        reviewer: { kind, fallback: reviewer.fallback },
      },
    };
  });
  return rows;
}

/**
 * COMPLIANCE-P0-11: one item per WonderID role a member holds, directly or
 * through a group (privileged roles only, or all). The item is about the
 * member's person identity; it goes to their manager or the named
 * reviewer, never to the member.
 */
async function buildRoleItems(tenantId: string, campaignId: string, input: LaunchCampaignInput): Promise<ItemRow[]> {
  const assignments = await listRoleAssignmentsForReview(tenantId, { privilegedOnly: input.scope?.privilegedOnly === true });
  const identityOf = await getHumanIdentityIdsForUsers(tenantId, assignments.map((a) => a.userId));
  const info = await getIdentityReviewInfo(tenantId, [...identityOf.values()]);
  const managers = await getIdentityReviewInfo(tenantId, [...new Set([...info.values()].map((p) => p.managerIdentityId).filter((x): x is string => Boolean(x)))]);
  const kind = input.reviewerKind ?? "named";
  const now = new Date().toISOString();
  const rows = assignments.flatMap((a) => {
    const identityId = identityOf.get(a.userId);
    if (!identityId) return [];
    const person = info.get(identityId);
    const managerId = person?.managerIdentityId ?? null;
    const reviewer = resolveReviewer(kind, { subjectUserId: a.userId, managerUserId: managerId ? (managers.get(managerId)?.userId ?? null) : null, applicationOwnerUserId: null }, input.reviewerId);
    return [
      {
        tenant_id: tenantId,
        campaign_id: campaignId,
        identity_id: identityId,
        role_id: a.roleId,
        role_source: a.source,
        group_id: a.groupId,
        reviewer_id: reviewer.reviewerId,
        risk_at_review: a.privileged ? "high" : null,
        usage_at_review: "unknown",
        recommendation: a.privileged ? "review" : "keep",
        due_date: input.dueDate ?? null,
        snapshot: {
          capturedAt: now,
          agentContractId: null,
          agentContractVersion: null,
          accessGrant: null,
          policyEvaluations: [],
          riskAtReview: null,
          usageAtReview: "unknown",
          person: { id: identityId, displayName: person?.displayName ?? "Unknown person", identityType: person?.identityType ?? "HUMAN" },
          role: {
            id: a.roleId,
            name: a.roleName,
            displayName: a.roleDisplayName,
            privileged: a.privileged,
            source: a.source,
            group: a.groupId ? { id: a.groupId, name: a.groupName ?? "" } : null,
            scopeType: a.scopeType,
            expiresAt: a.expiresAt,
          },
          privilegeLevel: a.privileged ? "privileged" : "standard",
          reviewer: { kind, fallback: reviewer.fallback },
        },
      },
    ];
  });
  // Privileged first.
  rows.sort((x, y) => Number(y.snapshot.role.privileged) - Number(x.snapshot.role.privileged));
  return rows;
}

/**
 * COMPLIANCE-P0-10 part 3: an owner review of access packages. One item per
 * application or entitlement an active package contains (one package, or
 * all), reviewed by the package's owner, or the named reviewer when the
 * package has no owner who can sign in. Certify keeps it; revoke removes
 * it from the package.
 */
async function buildPackageItems(tenantId: string, campaignId: string, input: LaunchCampaignInput): Promise<ItemRow[]> {
  const packageId = typeof input.scope?.packageId === "string" && input.scope.packageId ? input.scope.packageId : null;
  const packages = await listPackagesForReview(tenantId, packageId);
  const owners = await getIdentityReviewInfo(tenantId, [...new Set(packages.map((p) => p.ownerIdentityId).filter((x): x is string => Boolean(x)))]);
  const now = new Date().toISOString();
  return packages.flatMap((p) => {
    const ownerUserId = p.ownerIdentityId ? (owners.get(p.ownerIdentityId)?.userId ?? null) : null;
    const reviewer = { reviewerId: ownerUserId ?? input.reviewerId, fallback: !ownerUserId };
    return p.resources.map((r) => {
      const privileged = r.privilegeLevel === "admin" || r.privilegeLevel === "elevated" || r.risk === "high" || r.risk === "critical";
      return {
        tenant_id: tenantId,
        campaign_id: campaignId,
        package_id: p.id,
        package_resource_id: r.id,
        reviewer_id: reviewer.reviewerId,
        risk_at_review: privileged ? "high" : null,
        usage_at_review: "unknown",
        recommendation: privileged ? "review" : "keep",
        due_date: input.dueDate ?? null,
        snapshot: {
          capturedAt: now,
          agentContractId: null,
          agentContractVersion: null,
          accessGrant: null,
          policyEvaluations: [],
          riskAtReview: null,
          usageAtReview: "unknown",
          package: {
            id: p.id,
            ref: p.ref,
            name: p.name,
            birthright: p.birthright,
            resource: { id: r.id, applicationName: r.applicationName, entitlementName: r.entitlementName, privilegeLevel: r.privilegeLevel, risk: r.risk },
          },
          privilegeLevel: privileged ? "privileged" : "standard",
          reviewer: { kind: "package_owner", fallback: reviewer.fallback },
        },
      };
    });
  });
}

/** The items a campaign of this scope would hold, read and not written (launch writes them; preview counts them). */
async function buildItems(tenantId: string, campaignId: string, input: LaunchCampaignInput, ids: { applicationId: string | null; entitlementId: string | null }): Promise<ItemRow[]> {
  if (input.scopeType === "identity_access") return buildIdentityItems(tenantId, campaignId, input, ids.applicationId);
  if (input.scopeType === "role_assignments") return buildRoleItems(tenantId, campaignId, input);
  if (input.scopeType === "package_contents") return buildPackageItems(tenantId, campaignId, input);
  const { agents, grantFilter } = await scopeTargets(tenantId, input, ids);
  return buildAgentItems(tenantId, campaignId, agents, input, grantFilter);
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
    const total = await insertItems(await buildItems(tenantId, campaignId, input, ids));
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

/** Validates a launch's scope (before any row is written) and resolves the application or entitlement it names. */
async function resolveLaunchScope(tenantId: string, input: LaunchCampaignInput): Promise<{ applicationId: string | null; entitlementId: string | null }> {
  let applicationId: string | null = null;
  let entitlementId: string | null = null;
  if (input.scopeType === "application") {
    applicationId = typeof input.scope?.applicationId === "string" ? input.scope.applicationId : null;
    if (!applicationId) throw new ApiError(400, "INVALID_INPUT", "scope.applicationId is required for scope_type 'application'");
    if (!(await getApplication(tenantId, applicationId))) throw new ApiError(404, "APPLICATION_NOT_FOUND");
  } else if (input.scopeType === "identity_access") {
    // COMPLIANCE-P0-10: optionally one application; reviewer kind from a closed list.
    applicationId = typeof input.scope?.applicationId === "string" && input.scope.applicationId ? input.scope.applicationId : null;
    if (applicationId && !(await getApplication(tenantId, applicationId))) throw new ApiError(404, "APPLICATION_NOT_FOUND");
    if (input.reviewerKind !== undefined && !(REVIEWER_KINDS as readonly string[]).includes(input.reviewerKind)) throw new ApiError(400, "INVALID_INPUT", "reviewerKind: named, manager or application_owner");
  } else if (input.scopeType === "role_assignments") {
    // COMPLIANCE-P0-11: the manager or the named reviewer (roles have no application owner).
    if (input.reviewerKind !== undefined && input.reviewerKind !== "named" && input.reviewerKind !== "manager") throw new ApiError(400, "INVALID_INPUT", "reviewerKind: named or manager");
  } else if (input.scopeType === "package_contents") {
    // COMPLIANCE-P0-10 part 3: optionally one package; the reviewer is its owner (the named reviewer as fallback).
    const packageId = typeof input.scope?.packageId === "string" && input.scope.packageId ? input.scope.packageId : null;
    if (packageId && !(await listPackagesForReview(tenantId, packageId)).length) throw new ApiError(404, "PACKAGE_NOT_FOUND", "No such active package");
    if (input.reviewerKind !== undefined && input.reviewerKind !== "named") throw new ApiError(400, "INVALID_INPUT", "reviewerKind: a package's owner reviews it; the named reviewer is the fallback");
  } else if (input.scopeType === "entitlement") {
    entitlementId = typeof input.scope?.entitlementId === "string" ? input.scope.entitlementId : null;
    if (!entitlementId) throw new ApiError(400, "INVALID_INPUT", "scope.entitlementId is required for scope_type 'entitlement'");
    if (!(await getEntitlement(tenantId, entitlementId))) throw new ApiError(404, "ENTITLEMENT_NOT_FOUND");
  }

  return { applicationId, entitlementId };
}

/**
 * COMPLIANCE-P0-14: what a campaign would hold, before it is launched: the
 * same reads as the launch, nothing written. Counts only.
 */
export type CampaignPreview = { items: number; subjects: number; privileged: number; reviewers: number; reviewerFallbacks: number };

const PREVIEW_SCOPES = ["agent", "application", "entitlement", "privileged_access", "high_risk_agent", "identity_access", "role_assignments", "package_contents"] as const;

export async function previewCampaign(tenantId: string, input: LaunchCampaignInput): Promise<CampaignPreview> {
  await requireFeature(tenantId, "certifications");
  if (!(PREVIEW_SCOPES as readonly string[]).includes(input.scopeType)) throw new ApiError(400, "INVALID_INPUT", "scopeType: one of the campaign scopes");
  const ids = await resolveLaunchScope(tenantId, input);
  const rows = await buildItems(tenantId, "00000000-0000-0000-0000-000000000000", input, ids);
  const subjects = new Set(rows.map((r) => (r.identity_id ?? r.agent_id ?? r.package_id) as string));
  const reviewers = new Set(rows.map((r) => r.reviewer_id as string));
  const privileged = rows.filter((r) => r.risk_at_review === "high" || r.risk_at_review === "critical").length;
  const reviewerFallbacks = rows.filter((r) => (r.snapshot as { reviewer?: { fallback?: boolean } } | null)?.reviewer?.fallback === true).length;
  return { items: rows.length, subjects: subjects.size, privileged, reviewers: reviewers.size, reviewerFallbacks };
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

  const { applicationId, entitlementId } = await resolveLaunchScope(tenantId, input);

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
      reviewer_kind: input.scopeType === "identity_access" || input.scopeType === "role_assignments" ? (input.reviewerKind ?? "named") : "named",
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
    metadata: { scopeType: input.scopeType, scope: input.scope ?? {}, ...(input.scopeType === "identity_access" || input.scopeType === "role_assignments" ? { reviewerKind: input.reviewerKind ?? "named" } : {}) },
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
