import "server-only";

import type { RiskEvidence, RiskFinding } from "@/lib/shared/types/risk";

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

export function toRiskFinding(row: any): RiskFinding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    category: row.category,
    severity: row.severity,
    riskScore: row.risk_score,
    reasons: row.reasons ?? [],
    title: row.title,
    explanation: row.explanation,
    recommendation: row.recommendation,
    status: row.status,
    assignedTo: row.assigned_to,
    resolutionType: row.resolution_type,
    resolutionReason: row.resolution_reason,
    policyId: row.policy_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    evaluatorVersion: row.evaluator_version,
    falsePositiveExpiresAt: row.false_positive_expires_at,
  };
}

export function toRiskEvidence(row: any): RiskEvidence {
  return {
    id: row.id,
    findingId: row.finding_id,
    evidenceType: row.evidence_type,
    referenceId: row.reference_id,
    summary: row.summary,
    createdAt: row.created_at,
  };
}
