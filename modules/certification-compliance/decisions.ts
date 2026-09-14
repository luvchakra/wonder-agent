import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { revokeAccessGrant } from "@/modules/access-governance/service";
import type { CertificationDecision, CertificationItemDetail, DecisionType } from "@/lib/shared/types/compliance";
import { toCertificationDecision, toCertificationItem } from "./mappers";

export type RecordDecisionInput = {
  decision: DecisionType;
  justification: string;
  /** required for 'delegate' */
  delegateToUserId?: string;
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
