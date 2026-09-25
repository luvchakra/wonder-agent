import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { revokeAccessGrant } from "@/modules/access-governance/service";
import { notify } from "@/modules/operations/service";
import { compareShouldCanDid } from "@/modules/runtime-assurance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { EvidenceType, FindingFilter, FindingStatus, ResolutionType, RiskFinding, RogueCategory } from "@/lib/shared/types/risk";
import type { ShouldCanDidComparison } from "@/lib/shared/types/runtime";
import { toRiskEvidence, toRiskFinding } from "./mappers";
import { requireFeature } from "@/modules/platform-admin/service";

/**
 * OPERATIONS-P0-02.2's own worked example, wired here per that story's
 * instruction that each producing module picks this up in its own story
 * ("Risk Agent calls notify({type: 'critical_finding', ...}) right after
 * inserting a critical risk_findings row"). Same local-constant pattern
 * this session's RISK-P0-04 entry already documented as an existing,
 * accepted inconsistency (Operations' `ROGUE_AGENT_CATEGORIES` and
 * Experience's `ROGUE_CATEGORIES` are each their own file's copy, not a
 * shared export) — Risk Agent has no canonical exported constant for this
 * either, so this is a fourth same-shaped local copy, not a new pattern.
 */
const ROGUE_NOTIFY_CATEGORIES: RogueCategory[] = ["behavioral_deviation", "identity_anomaly", "ownership_violation", "lifecycle_violation"];

export async function notifyForFinding(tenantId: string, findingId: string, category: RogueCategory, severity: string, title: string, explanation: string) {
  if (severity === "critical") {
    await notify({
      tenantId,
      type: "critical_finding",
      title: `Critical risk finding: ${title}`,
      body: explanation,
      referenceType: "risk_finding",
      referenceId: findingId,
    });
  }
  if (ROGUE_NOTIFY_CATEGORIES.includes(category)) {
    await notify({
      tenantId,
      type: "rogue_agent",
      title: `Rogue-behavior finding: ${title}`,
      body: explanation,
      referenceType: "risk_finding",
      referenceId: findingId,
    });
  }
}

/**
 * risk_findings/risk_evidence grant client SELECT only (migration 0034) —
 * reads run as the calling user; tenant_id is still filtered explicitly as
 * defense-in-depth per CLAUDE.md §14.
 */
/**
 * Deliberately NOT given a `DEFAULT_LIST_LIMIT` cap (2026-09-16 pagination
 * pass, `lib/shared/pagination.ts`): QA's own grep for the gap only
 * matched `list*()`-named exports and missed this one, but it has the
 * same completeness-dependent callers as `listCampaignItems()`/
 * `listControlMappings()` — Compliance's evidence pack, campaign
 * population, and snapshot generation, plus Operations' compliance
 * reports — all depend on seeing every finding to be a correct evidence
 * artifact. A silent truncation here would be a compliance-integrity bug,
 * not just a performance one. The unfiltered, unbounded case is realistic
 * risk exposure worth tracking (a long-lived tenant's `risk_findings`
 * table genuinely grows without bound) — revisit with real keyset
 * pagination for the Risk index *page's* table specifically (a separate
 * concern from this function's aggregate-computation callers) rather than
 * a flat cap here.
 */
export async function getFindings(tenantId: string, filter: FindingFilter = {}): Promise<RiskFinding[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("risk_findings").select().eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (filter.agentId) query = query.eq("agent_id", filter.agentId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.category) query = query.eq("category", filter.category);
  if (filter.severity) query = query.eq("severity", filter.severity);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toRiskFinding);
}

export async function getFinding(tenantId: string, findingId: string): Promise<RiskFinding | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("risk_findings").select().eq("tenant_id", tenantId).eq("id", findingId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;

  const { data: evidenceRows, error: evidenceError } = await supabase
    .from("risk_evidence")
    .select()
    .eq("finding_id", findingId)
    .order("created_at", { ascending: true });
  if (evidenceError) throw new ApiError(500, "QUERY_FAILED", evidenceError.message);

  return { ...toRiskFinding(data), evidence: (evidenceRows ?? []).map(toRiskEvidence) };
}

/**
 * RUNTIME-P0-13 — the caller `compareShouldCanDid(tenantId, agentId, asOf?)`
 * was waiting on ("no existing caller passes a real asOf yet"). A finding's
 * own `created_at` is exactly the "point in time" the story's acceptance
 * criteria cares about: it's set once on insert and never touched again by
 * `createOrUpdateFinding()`'s update branch, so it's a stable "when was
 * this first detected" anchor. Reconstructs what CAN looked like at that
 * moment, so a reviewer can see a genuine historical `excessive_access`
 * finding's justification even if the entitlement has since been revoked
 * (re-evaluating with *today's* CAN would otherwise make the evidence look
 * unexplainable) — the exact distortion risk RUNTIME-P0-13 named.
 */
export async function getFindingAsOfDetection(
  tenantId: string,
  findingId: string,
): Promise<{ finding: RiskFinding; comparisonAsOfDetection: ShouldCanDidComparison } | null> {
  const finding = await getFinding(tenantId, findingId);
  if (!finding) return null;
  const comparisonAsOfDetection = await compareShouldCanDid(tenantId, finding.agentId, finding.createdAt);
  return { finding, comparisonAsOfDetection };
}

type EvidenceInput = { evidenceType: EvidenceType; referenceId: string; summary: string };

/**
 * RISK-P0-01.2's dedup rule: an existing open/assigned/remediation_in_progress
 * finding for the same agent+category is updated (new evidence appended,
 * severity/score/explanation refreshed) rather than duplicated. Used only by
 * modules/risk/rules.ts's detection engine — writes go through the
 * service-role client since risk_findings/risk_evidence have no
 * client-facing write policy at all (migration 0034's comment: a forgeable
 * finding would undermine the same evidentiary guarantee every other
 * findings-style table in this build protects).
 */
export async function createOrUpdateFinding(
  tenantId: string,
  agentId: string,
  category: RogueCategory,
  fields: {
    severity: string;
    riskScore: number;
    reasons: string[];
    title: string;
    explanation: string;
    recommendation: string;
    policyId?: string | null;
    evaluatorVersion?: number;
  },
  evidence: EvidenceInput[],
): Promise<{ finding: RiskFinding; created: boolean }> {
  const supabase = supabaseServiceRole();

  // RISK-P0-03.5 — an expired false_positive disposition is reopenable by
  // the same re-evaluation machinery that updates any other open finding,
  // rather than a separate scheduler this codebase has no job-runner for
  // yet (see the Risk Agent audit log's 2026-09-14 entry for the scoping
  // note). A false_positive whose expiry hasn't passed (or has none) stays
  // closed and a fresh finding is not opened for it here.
  const nowIso = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("risk_findings")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .eq("category", category)
    .or(
      `status.in.(open,acknowledged,investigating,assigned,remediation_in_progress),and(status.eq.false_positive,false_positive_expires_at.lt.${nowIso})`,
    )
    .maybeSingle();
  if (existingError) throw new ApiError(500, "QUERY_FAILED", existingError.message);

  if (existing) {
    const reopening = existing.status === "false_positive";
    const { data: updated, error: updateError } = await supabase
      .from("risk_findings")
      .update({
        severity: fields.severity,
        risk_score: fields.riskScore,
        reasons: fields.reasons,
        explanation: fields.explanation,
        recommendation: fields.recommendation,
        evaluator_version: fields.evaluatorVersion ?? existing.evaluator_version,
        ...(reopening ? { status: "open", resolution_type: null, resolution_reason: null, resolved_at: null, false_positive_expires_at: null } : {}),
      })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId)
      .select()
      .single();
    if (updateError || !updated) throw new ApiError(500, "UPDATE_FAILED", updateError?.message ?? "Failed to update finding");

    if (reopening) {
      await writeAudit({
        tenantId,
        actorId: null,
        actorType: "system",
        action: "risk.finding_reopened_after_false_positive_expiry",
        objectType: "risk_finding",
        objectId: existing.id,
        outcome: "success",
        metadata: { category, previousStatus: "false_positive" },
      });
    }

    const { data: existingEvidence, error: existingEvidenceError } = await supabase
      .from("risk_evidence")
      .select("reference_id")
      .eq("finding_id", existing.id);
    if (existingEvidenceError) throw new ApiError(500, "QUERY_FAILED", existingEvidenceError.message);
    const knownRefs = new Set((existingEvidence ?? []).map((e: { reference_id: string }) => e.reference_id));
    const newEvidence = evidence.filter((e) => !knownRefs.has(e.referenceId));
    if (newEvidence.length > 0) {
      const { error: insertEvidenceError } = await supabase
        .from("risk_evidence")
        .insert(newEvidence.map((e) => ({ finding_id: existing.id, evidence_type: e.evidenceType, reference_id: e.referenceId, summary: e.summary })));
      if (insertEvidenceError) throw new ApiError(500, "CREATE_FAILED", insertEvidenceError.message);
    }

    // Only a genuinely new alert-worthy state change (reopened from
    // false_positive) notifies — a routine re-evaluation refresh of an
    // already-open finding (same status, just refreshed evidence/score)
    // does not re-fire the same alert on every evaluateAgentRisk() call.
    if (reopening) {
      await notifyForFinding(tenantId, existing.id, category, fields.severity, fields.title, fields.explanation);
    }

    return { finding: toRiskFinding(updated), created: false };
  }

  const { data: created, error: createError } = await supabase
    .from("risk_findings")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      category,
      severity: fields.severity,
      risk_score: fields.riskScore,
      reasons: fields.reasons,
      title: fields.title,
      explanation: fields.explanation,
      recommendation: fields.recommendation,
      policy_id: fields.policyId ?? null,
      evaluator_version: fields.evaluatorVersion ?? 1,
    })
    .select()
    .single();
  if (createError || !created) throw new ApiError(500, "CREATE_FAILED", createError?.message ?? "Failed to create finding");

  if (evidence.length > 0) {
    const { error: insertEvidenceError } = await supabase
      .from("risk_evidence")
      .insert(evidence.map((e) => ({ finding_id: created.id, evidence_type: e.evidenceType, reference_id: e.referenceId, summary: e.summary })));
    if (insertEvidenceError) throw new ApiError(500, "CREATE_FAILED", insertEvidenceError.message);
  }

  await writeAudit({
    tenantId,
    actorId: null,
    actorType: "system",
    action: "risk.finding_created",
    objectType: "risk_finding",
    objectId: created.id,
    outcome: "success",
    metadata: { agentId, category, severity: fields.severity },
  });

  await notifyForFinding(tenantId, created.id, category, fields.severity, fields.title, fields.explanation);

  return { finding: toRiskFinding(created), created: true };
}

/** RISK-P0-03.1. */
export async function assignFinding(tenantId: string, actorId: string, findingId: string, assigneeId: string): Promise<RiskFinding> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("risk_findings")
    .update({ assigned_to: assigneeId, status: "assigned" })
    .eq("id", findingId)
    .eq("tenant_id", tenantId)
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "FINDING_NOT_FOUND");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.finding_assigned",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: "success",
    metadata: { assigneeId },
  });

  return toRiskFinding(data);
}

/**
 * RISK-P0-03.2. Risk Agent never revokes access itself (non-negotiable
 * #6/#15) — it calls Access Agent's already-published
 * `revokeAccessGrant(tenantId, actorId, grantId)` for every grant this
 * finding's own evidence names (`evidence_type = 'access_grant'`,
 * `reference_id` = the grant's id — the exact evidence shape
 * `detectExcessiveAccess()`/`detectUnauthorizedResource()`/etc. already
 * attach in rules.ts). The human who clicked "Request remediation" is the
 * explicit approval non-negotiable #15 requires — this function performs
 * the hand-off synchronously rather than only creating a pending
 * `access_requests` row, since revoking excessive/unauthorized access is
 * itself the corrective action, not a request for new access (which is
 * what `createAccessRequest()` models instead — a different, wrong-
 * direction contract for this use case).
 *
 * A finding whose category has no `access_grant` evidence (e.g.
 * ownership_violation, lifecycle_violation, governance_drift) has no
 * grant to revoke — `wired` is honestly `false` for those, with a note,
 * rather than fabricating a hand-off. A grant that's already
 * revoked/removed by the time this runs doesn't fail the whole call; it's
 * skipped and reflected in `wired` only if zero grants actually revoked.
 */
export async function remediateFinding(
  tenantId: string,
  actorId: string,
  findingId: string,
): Promise<{ finding: RiskFinding; wired: boolean; revokedGrantIds: string[] }> {
  // PLATFORM-P0-12: remediation is a flag-gated capability (on by default).
  await requireFeature(tenantId, "remediation");
  const supabase = supabaseServiceRole();
  const { data: findingRow, error } = await supabase.from("risk_findings").select().eq("id", findingId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!findingRow) throw new ApiError(404, "FINDING_NOT_FOUND");

  const { data: evidenceRows, error: evidenceError } = await supabase.from("risk_evidence").select().eq("finding_id", findingId);
  if (evidenceError) throw new ApiError(500, "QUERY_FAILED", evidenceError.message);

  const grantIds = [...new Set((evidenceRows ?? []).filter((e) => e.evidence_type === "access_grant").map((e) => e.reference_id as string))];

  const revokedGrantIds: string[] = [];
  for (const grantId of grantIds) {
    try {
      await revokeAccessGrant(tenantId, actorId, grantId);
      revokedGrantIds.push(grantId);
    } catch (err) {
      console.error("remediateFinding: failed to revoke grant (already removed?)", { grantId, err });
    }
  }

  const wired = revokedGrantIds.length > 0;

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.remediation_requested",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: wired ? "success" : "failure",
    metadata: wired
      ? { revokedGrantIds }
      : {
          reason:
            grantIds.length > 0
              ? "This finding named access_grant evidence but none could be revoked (already removed?)."
              : "This finding's category has no access_grant evidence to remediate via revocation.",
        },
  });

  let finalRow = findingRow;
  if (wired) {
    const { data: updated, error: updateError } = await supabase
      .from("risk_findings")
      .update({ status: "remediation_in_progress" })
      .eq("id", findingId)
      .eq("tenant_id", tenantId)
      .select()
      .maybeSingle();
    if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
    if (updated) finalRow = updated;
  }

  return { finding: toRiskFinding(finalRow), wired, revokedGrantIds };
}

/**
 * RISK-P0-03.3. `reevaluate` must be the same detection rule that created
 * this finding, re-run against current evidence — the caller (the API
 * route) passes whether that re-check still triggers, since the actual
 * re-run lives in rules.ts (which needs the full evaluation context). This
 * function only enforces the "verified_fixed requires the rule to no
 * longer trigger" invariant and performs the status transition + audit.
 */
export async function resolveFinding(
  tenantId: string,
  actorId: string,
  findingId: string,
  resolution: { type: ResolutionType; reason?: string; stillTriggered?: boolean; expiresAt?: string | null },
): Promise<RiskFinding> {
  if (resolution.type === "verified_fixed" && resolution.stillTriggered) {
    throw new ApiError(412, "PRECONDITION_FAILED", "The underlying evidence still triggers this finding's rule — cannot resolve as verified_fixed");
  }
  if ((resolution.type === "accepted_risk" || resolution.type === "false_positive") && !resolution.reason?.trim()) {
    throw new ApiError(400, "INVALID_INPUT", `${resolution.type} resolution requires a reason`);
  }

  // RISK-P0-03.5 — the optional expiry after which a false_positive
  // disposition is automatically re-evaluated by createOrUpdateFinding's
  // reopen check above; original risk_evidence rows are never touched here.
  let falsePositiveExpiresAt: string | null = null;
  if (resolution.type === "false_positive" && resolution.expiresAt) {
    const parsed = new Date(resolution.expiresAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new ApiError(400, "INVALID_INPUT", "expiresAt must be a valid future timestamp");
    }
    falsePositiveExpiresAt = parsed.toISOString();
  }

  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("risk_findings")
    .update({
      status: resolution.type === "false_positive" ? "false_positive" : "resolved",
      resolution_type: resolution.type,
      resolution_reason: resolution.reason ?? null,
      resolved_at: new Date().toISOString(),
      false_positive_expires_at: falsePositiveExpiresAt,
    })
    .eq("id", findingId)
    .eq("tenant_id", tenantId)
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "FINDING_NOT_FOUND");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.finding_resolved",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: "success",
    metadata: { resolutionType: resolution.type, falsePositiveExpiresAt },
  });

  return toRiskFinding(data);
}

const LIFECYCLE_TRANSITION_STATUSES: FindingStatus[] = ["acknowledged", "investigating", "mitigated", "exception"];

/**
 * RISK-P0-03.4 — the finer-grained lifecycle states the requirements
 * package calls out by name, beyond the open/assigned/remediation_in_progress/
 * resolved/false_positive states each already wired through their own
 * dedicated function above. A finding already in a terminal disposition
 * (`resolved`/`false_positive`) cannot be moved by this generic transition —
 * reopening a false_positive is `createOrUpdateFinding`'s job when its
 * expiry passes, not a manual free-form transition.
 */
export async function transitionFindingStatus(
  tenantId: string,
  actorId: string,
  findingId: string,
  toStatus: FindingStatus,
): Promise<RiskFinding> {
  if (!LIFECYCLE_TRANSITION_STATUSES.includes(toStatus)) {
    throw new ApiError(400, "INVALID_INPUT", `toStatus must be one of ${LIFECYCLE_TRANSITION_STATUSES.join(", ")}`);
  }

  const supabase = supabaseServiceRole();
  const { data: existing, error: existingError } = await supabase
    .from("risk_findings")
    .select("status")
    .eq("id", findingId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existingError) throw new ApiError(500, "QUERY_FAILED", existingError.message);
  if (!existing) throw new ApiError(404, "FINDING_NOT_FOUND");
  if (existing.status === "resolved" || existing.status === "false_positive") {
    throw new ApiError(412, "PRECONDITION_FAILED", "Cannot move a resolved or false_positive finding via a lifecycle transition — resolve or wait for reopen instead");
  }

  const { data, error } = await supabase
    .from("risk_findings")
    .update({ status: toStatus })
    .eq("id", findingId)
    .eq("tenant_id", tenantId)
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "FINDING_NOT_FOUND");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.finding_status_changed",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: "success",
    metadata: { fromStatus: existing.status, toStatus },
  });

  return toRiskFinding(data);
}
