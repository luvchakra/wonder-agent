import "server-only";

import { listAgents, listOwners } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { listCampaigns, listCampaignItems, listControlFrameworks, listControls, listControlMappings } from "@/modules/certification-compliance/service";
import { listAuditLogs } from "./audit";
import type { ReportOutput, ReportRow, ReportType } from "@/lib/shared/types/operations";
import type { RogueCategory } from "@/lib/shared/types/risk";

/**
 * OPERATIONS-P0-04.1/04.2. Every report is computed live from each owning
 * module's existing tenant-scoped read contract at generation time — never
 * cached (so a later requester can never see stale or cross-tenant data,
 * per the story's own explicit instruction) — and carries `generatedAt`
 * plus a per-row `href` so a consumer can drill through to the underlying
 * record, satisfying OPERATIONS-P0-04.2's traceability requirement without
 * changing this computation model.
 */
function output(reportType: ReportType, rows: ReportRow[]): ReportOutput {
  return { reportType, generatedAt: new Date().toISOString(), recordCount: rows.length, rows };
}

export async function generateAgentInventoryReport(tenantId: string): Promise<ReportOutput> {
  const agents = await listAgents(tenantId);
  return output(
    "agent_inventory",
    agents.map((a) => ({
      id: a.id,
      href: `/agents/${a.id}`,
      fields: { name: a.agentName, type: a.agentType, environment: a.environment, criticality: a.criticality, lifecycleState: a.lifecycleState },
    })),
  );
}

export async function generateOwnershipReport(tenantId: string): Promise<ReportOutput> {
  const agents = await listAgents(tenantId);
  const rows = await Promise.all(
    agents.map(async (a) => {
      const owners = await listOwners(tenantId, a.id);
      return {
        id: a.id,
        href: `/agents/${a.id}`,
        fields: {
          agentName: a.agentName,
          owners: owners.map((o) => `${o.ownerType}:${o.userId}`).join("; ") || "(none)",
          ownerCount: owners.length,
        },
      };
    }),
  );
  return output("ownership", rows);
}

export async function generateAccessCertificationReport(tenantId: string): Promise<ReportOutput> {
  const campaigns = await listCampaigns(tenantId);
  const rows: ReportRow[] = [];
  for (const campaign of campaigns) {
    const items = await listCampaignItems(tenantId, campaign.id);
    for (const item of items) {
      rows.push({
        id: item.id,
        href: `/compliance/campaigns/${campaign.id}`,
        fields: {
          campaign: campaign.name,
          agentId: item.agentId,
          status: item.status,
          recommendation: item.recommendation,
          riskAtReview: item.riskAtReview,
        },
      });
    }
  }
  return output("access_certification", rows);
}

/** Rogue-agent-behavior categories, as distinct from the access-violation subset below (an explicit, documented partition of Risk's eight categories — not a Risk Agent contract change). */
const ROGUE_AGENT_CATEGORIES: RogueCategory[] = ["behavioral_deviation", "identity_anomaly", "ownership_violation", "lifecycle_violation"];
const ACCESS_VIOLATION_CATEGORIES: RogueCategory[] = ["excessive_access", "unauthorized_resource", "unauthorized_action", "sensitive_data_violation"];

export async function generateRogueAgentReport(tenantId: string): Promise<ReportOutput> {
  const findings = await getFindings(tenantId);
  const rows = findings
    .filter((f) => ROGUE_AGENT_CATEGORIES.includes(f.category))
    .map((f) => ({
      id: f.id,
      href: `/risk/agents/${f.agentId}`,
      fields: { agentId: f.agentId, category: f.category, severity: f.severity, status: f.status, title: f.title },
    }));
  return output("rogue_agent", rows);
}

export async function generateAccessViolationReport(tenantId: string): Promise<ReportOutput> {
  const findings = await getFindings(tenantId);
  const rows = findings
    .filter((f) => ACCESS_VIOLATION_CATEGORIES.includes(f.category))
    .map((f) => ({
      id: f.id,
      href: `/risk/agents/${f.agentId}`,
      fields: { agentId: f.agentId, category: f.category, severity: f.severity, status: f.status, title: f.title },
    }));
  return output("access_violation", rows);
}

export async function generateRiskReport(tenantId: string): Promise<ReportOutput> {
  const findings = await getFindings(tenantId);
  const rows = findings.map((f) => ({
    id: f.id,
    href: `/risk/agents/${f.agentId}`,
    fields: { agentId: f.agentId, category: f.category, severity: f.severity, riskScore: f.riskScore, status: f.status },
  }));
  return output("risk", rows);
}

const AUDIT_EVIDENCE_REPORT_MAX_ROWS = 1000;

export async function generateAuditEvidenceReport(tenantId: string): Promise<ReportOutput> {
  const page = await listAuditLogs(tenantId, {}, null, AUDIT_EVIDENCE_REPORT_MAX_ROWS);
  const rows = page.entries.map((e) => ({
    id: e.id,
    href: `/audit?objectType=${e.objectType}`,
    fields: { action: e.action, objectType: e.objectType, objectId: e.objectId, outcome: e.outcome, actorId: e.actorId, createdAt: e.createdAt },
  }));
  return output("audit_evidence", rows);
}

export async function generatePolicyComplianceReport(tenantId: string): Promise<ReportOutput> {
  const [mappings, frameworks] = await Promise.all([listControlMappings(tenantId), listControlFrameworks()]);
  const controlsByFramework = new Map<string, Awaited<ReturnType<typeof listControls>>>();
  for (const fw of frameworks) {
    controlsByFramework.set(fw.id, await listControls(fw.id));
  }
  const controlById = new Map<string, { controlRef: string; requirement: string; frameworkId: string }>();
  for (const [frameworkId, controls] of controlsByFramework) {
    for (const c of controls) controlById.set(c.id, { controlRef: c.controlRef, requirement: c.requirement, frameworkId });
  }

  const rows = mappings.map((m) => {
    const control = controlById.get(m.controlId);
    return {
      id: m.id,
      href: `/policies/${m.policyId ?? ""}`,
      fields: { control: control?.controlRef ?? m.controlId, requirement: control?.requirement ?? null, status: m.status, policyId: m.policyId },
    };
  });
  return output("policy_compliance", rows);
}

export async function generateReport(tenantId: string, reportType: ReportType): Promise<ReportOutput> {
  switch (reportType) {
    case "agent_inventory":
      return generateAgentInventoryReport(tenantId);
    case "ownership":
      return generateOwnershipReport(tenantId);
    case "access_certification":
      return generateAccessCertificationReport(tenantId);
    case "rogue_agent":
      return generateRogueAgentReport(tenantId);
    case "access_violation":
      return generateAccessViolationReport(tenantId);
    case "risk":
      return generateRiskReport(tenantId);
    case "audit_evidence":
      return generateAuditEvidenceReport(tenantId);
    case "policy_compliance":
      return generatePolicyComplianceReport(tenantId);
  }
}
