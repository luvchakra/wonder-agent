import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { revokeAccessGrant } from "@/modules/access-governance/service";
import { listOwners } from "@/modules/agent-identity/service";
import type { CertificationDecision, CertificationItemDetail, DecisionType } from "@/lib/shared/types/compliance";
import { toCertificationDecision, toCertificationItem } from "./mappers";
import { buildFreshSnapshot } from "./snapshot";

export type RecordDecisionInput = {
  decision: DecisionType;
  justification: string;
  /** required for 'delegate' */
  delegateToUserId?: string;
  /**
   * COMPLIANCE-P0-04 — required to `approve` when the caller is one of the
   * agent's owners (a self-certification SoD conflict); ignored otherwise.
   * Its use is always audited as its own event, distinct from the decision
   * itself.
   */
  overrideSoD?: boolean;
};

/**
 * COMPLIANCE-P0-01.3. Every decision is written once, immutably —
 * certification_decisions has no client-facing write policy at all
 * (migration 0036) and, deliberately, no UPDATE policy for anyone: a
 * correction is a new decision row, never an edit, per non-negotiable #11.
 */
export async function recordDecision(
  tenantId: string,
  actorId: string,
  itemId: string,
  input: RecordDecisionInput,
): Promise<CertificationDecision> {
  if (!input.justification.trim()) throw new ApiError(400, "INVALID_INPUT", "justification is required");
  if (input.decision === "delegate" && !input.delegateToUserId) {
    throw new ApiError(400, "INVALID_INPUT", "delegateToUserId is required for a delegate decision");
  }

  const supabase = supabaseServiceRole();
  const { data: itemRow, error: itemError } = await supabase.from("certification_items").select().eq("id", itemId).eq("tenant_id", tenantId).maybeSingle();
  if (itemError) throw new ApiError(500, "QUERY_FAILED", itemError.message);
  if (!itemRow) throw new ApiError(404, "ITEM_NOT_FOUND");
  const item = toCertificationItem(itemRow);

  // COMPLIANCE-P0-04 — only the item's current reviewer (or an explicitly
  // delegated one — 'delegate' reassigns reviewer_id, so this same check
  // already covers that case) may record a decision on it.
  if (item.reviewerId !== actorId) {
    await writeAudit({
      tenantId,
      actorId,
      actorType: "user",
      action: "compliance.decision_rejected_not_reviewer",
      objectType: "certification_item",
      objectId: itemId,
      outcome: "failure",
      metadata: { reviewerId: item.reviewerId },
    });
    throw new ApiError(403, "NOT_ASSIGNED_REVIEWER", "Only the item's assigned reviewer may record a decision on it");
  }

  // COMPLIANCE-P0-04 — Segregation of Duties: a reviewer must not approve
  // (certify) an agent whose access they themselves own. Scoped to
  // 'approve' — the decision that actually affirms the access as correct —
  // rather than every decision type, since revoke/modify/delegate/
  // request_information don't carry the same self-serving-bias risk.
  if (input.decision === "approve") {
    const owners = await listOwners(tenantId, item.agentId);
    const reviewerIsOwner = owners.some((o) => o.userId === actorId);
    if (reviewerIsOwner && !input.overrideSoD) {
      await writeAudit({
        tenantId,
        actorId,
        actorType: "user",
        action: "compliance.sod_conflict_blocked",
        objectType: "certification_item",
        objectId: itemId,
        outcome: "failure",
        metadata: { reason: "Reviewer is an owner of this agent; self-certification requires an explicit SoD override." },
      });
      throw new ApiError(409, "SOD_CONFLICT", "You are an owner of this agent and cannot approve its own certification without an explicit override");
    }
    if (reviewerIsOwner && input.overrideSoD) {
      await writeAudit({
        tenantId,
        actorId,
        actorType: "user",
        action: "compliance.sod_override_used",
        objectType: "certification_item",
        objectId: itemId,
        outcome: "success",
        metadata: { reason: "Reviewer is an owner of this agent; approved with an explicit SoD override." },
      });
    }
  }

  // COMPLIANCE-P0-03 — a fresh snapshot at the moment of decision, which
  // may differ from the item's population-time snapshot if the agent's
  // contract or policies changed in between.
  const snapshot = await buildFreshSnapshot(tenantId, item.agentId, item.accessGrantId);

  let remediationId: string | null = null;

  if (input.decision === "revoke") {
    if (item.accessGrantId) {
      // The human decision just captured (this call) IS the required
      // approval — non-negotiable #15 is satisfied by the reviewer's
      // decision itself, not a separate re-confirmation.
      await revokeAccessGrant(tenantId, actorId, item.accessGrantId);
      remediationId = item.accessGrantId;
    } else {
      await writeAudit({
        tenantId,
        actorId,
        actorType: "user",
        action: "compliance.revoke_without_specific_grant",
        objectType: "certification_item",
        objectId: itemId,
        outcome: "failure",
        metadata: { reason: "This item has no access_grant_id (not an entitlement-level item) — no specific grant to revoke automatically. Manual action required." },
      });
    }
  } else if (input.decision === "modify") {
    // Flagged, not silently assumed: the backlog says this "creates an
    // access_requests row of type modify," but Access Agent's
    // access_requests schema (migration 0028) has no type discriminator
    // between a new-access request and a modify request — repurposing it
    // without one would misrepresent this as a plain access request to
    // any consumer of that table (e.g. Access Agent's own SoD checker).
    // The modify intent is fully captured in this decision's own
    // `justification` (required, immutable) instead; no access_requests
    // row is created until Access Agent publishes a distinct type.
    await writeAudit({
      tenantId,
      actorId,
      actorType: "user",
      action: "compliance.modify_not_wired",
      objectType: "certification_item",
      objectId: itemId,
      outcome: "failure",
      metadata: { reason: "Access Agent's access_requests table has no 'modify' type; the intended change is recorded only in this decision's justification." },
    });
  }

  const { data: decisionRow, error: decisionError } = await supabase
    .from("certification_decisions")
    .insert({
      item_id: itemId,
      decision: input.decision,
      justification: input.justification,
      decided_by: actorId,
      remediation_id: remediationId,
      snapshot,
    })
    .select()
    .single();
  if (decisionError || !decisionRow) throw new ApiError(500, "CREATE_FAILED", decisionError?.message ?? "Failed to record decision");

  if (input.decision === "delegate") {
    const { error: updateError } = await supabase.from("certification_items").update({ reviewer_id: input.delegateToUserId }).eq("id", itemId);
    if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  } else if (input.decision !== "request_information") {
    const { error: updateError } = await supabase.from("certification_items").update({ status: "decided" }).eq("id", itemId);
    if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  }
  // 'request_information' leaves status='pending' — a notification-worthy
  // event for Operations Agent to consume once it exists; the audit_logs
  // row below is that event in the meantime.

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "compliance.decision_recorded",
    objectType: "certification_decision",
    objectId: decisionRow.id,
    outcome: "success",
    metadata: { itemId, decision: input.decision },
  });

  return toCertificationDecision(decisionRow);
}

export async function listDecisionsForItem(tenantId: string, itemId: string): Promise<CertificationDecision[]> {
  const supabase = await supabaseServer();
  const { data: item, error: itemError } = await supabase.from("certification_items").select("id").eq("id", itemId).eq("tenant_id", tenantId).maybeSingle();
  if (itemError) throw new ApiError(500, "QUERY_FAILED", itemError.message);
  if (!item) throw new ApiError(404, "ITEM_NOT_FOUND");

  const { data, error } = await supabase.from("certification_decisions").select().eq("item_id", itemId).order("decided_at", { ascending: true });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toCertificationDecision);
}

/** COMPLIANCE-P0-01.4. Everything the certification detail panel needs for one item. */
export async function getCertificationItemDetail(tenantId: string, itemId: string): Promise<CertificationItemDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("certification_items").select().eq("id", itemId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;

  const decisions = await listDecisionsForItem(tenantId, itemId);
  return { ...toCertificationItem(data), decisions };
}

/**
 * Published contract: "getCertificationHistory(agentId) — Identity/Risk
 * reference this for 'last certified' facts." Returns every decided item
 * (across all campaigns) for the agent, most recent first.
 */
export async function getCertificationHistory(tenantId: string, agentId: string): Promise<CertificationDecision[]> {
  const supabase = await supabaseServer();
  const { data: items, error: itemsError } = await supabase.from("certification_items").select("id").eq("tenant_id", tenantId).eq("agent_id", agentId);
  if (itemsError) throw new ApiError(500, "QUERY_FAILED", itemsError.message);
  const itemIds = (items ?? []).map((i: { id: string }) => i.id);
  if (itemIds.length === 0) return [];

  const { data, error } = await supabase.from("certification_decisions").select().in("item_id", itemIds).order("decided_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toCertificationDecision);
}
