import "server-only";

import { listAgents } from "@/modules/agent-identity/service";
import { listApplications, listPolicies } from "@/modules/access-governance/service";
import { getFindings } from "@/modules/risk/service";
import { listCampaigns } from "@/modules/certification-compliance/service";
import { listIntegrations } from "@/modules/integrations/service";
import type { RiskSeverity } from "@/lib/shared/types/risk";
import type { SearchResult } from "@/lib/shared/types/operations";

/**
 * OPERATIONS-P0-03.2 — pure. `riskMasked: true` means the caller lacks
 * `risk.read` and the field was deliberately withheld; distinct from
 * `riskSeverity: null` (visible to the caller, simply no open finding).
 */
export function maskRiskField(rawSeverity: RiskSeverity | null, canViewRisk: boolean): { riskSeverity: RiskSeverity | null; riskMasked: boolean } {
  if (!canViewRisk) return { riskSeverity: null, riskMasked: true };
  return { riskSeverity: rawSeverity, riskMasked: false };
}

const SEVERITY_RANK: Record<RiskSeverity, number> = { info: -1, low: 0, medium: 1, high: 2, critical: 3 };

/**
 * OPERATIONS-P0-03.1/03.2. Fans out to each domain module's own
 * tenant-scoped read contract (never a separate denormalized search index
 * — the same RLS/permission boundaries that already protect the source
 * data apply automatically) and filters per object type by the calling
 * user's actual permissions, checked here rather than left to the UI —
 * per the story's own explicit "verify this specifically" acceptance
 * note, a result type the caller cannot see never enters the returned
 * array at all.
 *
 * **Scope, flagged rather than silently assumed**: the backlog's object-
 * type list also names "identity" and "owner" and "entitlement" — none of
 * Identity/Access's published contracts expose a tenant-wide (as opposed
 * to per-agent/per-application) list for these, so building one here would
 * mean reaching into their internal schema rather than composing their
 * existing contract (non-negotiable #6). Implemented: agent, application,
 * finding, certification_campaign, policy, integration — six of the nine
 * named types, each backed by a real tenant-wide list function.
 */
export async function search(tenantId: string, permissions: string[], query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const canViewRisk = permissions.includes("risk.read");
  const results: SearchResult[] = [];

  // Findings fetched once (if visible) up front — both to answer the
  // 'finding' object type itself and to attach a risk indicator to
  // matching agent results below, without a per-agent query each.
  const findings = canViewRisk ? await getFindings(tenantId, { status: "open" }) : [];
  const worstFindingByAgent = new Map<string, RiskSeverity>();
  for (const f of findings) {
    const current = worstFindingByAgent.get(f.agentId);
    if (!current || SEVERITY_RANK[f.severity] > SEVERITY_RANK[current]) worstFindingByAgent.set(f.agentId, f.severity);
  }

  if (permissions.includes("agent.read")) {
    const agents = await listAgents(tenantId);
    for (const a of agents) {
      if (!a.agentName.toLowerCase().includes(q)) continue;
      const masked = maskRiskField(worstFindingByAgent.get(a.id) ?? null, canViewRisk);
      results.push({
        objectType: "agent",
        id: a.id,
        title: a.agentName,
        subtitle: a.agentType,
        href: `/agents/${a.id}`,
        freshness: new Date().toISOString(),
        ...masked,
      });
    }
  }

  if (permissions.includes("access.read")) {
    const applications = await listApplications(tenantId);
    for (const app of applications) {
      if (!app.name.toLowerCase().includes(q)) continue;
      results.push({
        objectType: "application",
        id: app.id,
        title: app.name,
        subtitle: app.category,
        href: `/access`,
        freshness: app.createdAt,
      });
    }
  }

  if (canViewRisk) {
    for (const f of findings) {
      if (!f.title.toLowerCase().includes(q)) continue;
      results.push({
        objectType: "finding",
        id: f.id,
        title: f.title,
        subtitle: f.category,
        href: `/risk/agents/${f.agentId}`,
        freshness: f.createdAt,
        riskSeverity: f.severity,
        riskMasked: false,
      });
    }
  }

  if (permissions.includes("compliance.read")) {
    const campaigns = await listCampaigns(tenantId);
    for (const c of campaigns) {
      if (!c.name.toLowerCase().includes(q)) continue;
      results.push({
        objectType: "certification_campaign",
        id: c.id,
        title: c.name,
        subtitle: c.status,
        href: `/compliance/campaigns/${c.id}`,
        freshness: c.createdAt,
      });
    }
  }

  if (permissions.includes("policy.read")) {
    const policies = await listPolicies(tenantId);
    for (const p of policies) {
      if (!p.name.toLowerCase().includes(q)) continue;
      results.push({
        objectType: "policy",
        id: p.id,
        title: p.name,
        subtitle: p.policyCategory,
        href: `/policies/${p.id}`,
        freshness: p.effectiveDate,
      });
    }
  }

  if (permissions.includes("integration.read")) {
    const integrations = await listIntegrations(tenantId);
    for (const i of integrations) {
      if (!i.name.toLowerCase().includes(q)) continue;
      results.push({
        objectType: "integration",
        id: i.id,
        title: i.name,
        subtitle: i.status,
        href: `/integrations/${i.id}`,
        freshness: i.lastSyncAt ?? i.createdAt,
      });
    }
  }

  return results;
}
