import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { removeRole, setRoleAssignmentEnd } from "@/lib/rbac/roles";
import { removeGroupMember } from "@/lib/users/groups";
import { ApiError } from "@/lib/shared/types/foundation";
import { revokeAccessGrant, getAccessGrant, getEntitlement, createAccessRequest, recordApprovedAfterwards, requestCertifiedRemoval } from "@/modules/access-governance/service";
import { getIdentityReviewInfo, listOwners } from "@/modules/agent-identity/service";
import { escalationTarget, IDENTITY_ITEM_DECISIONS, selfCertificationRefused, validateUntil } from "./identityReviewRules";
import type { CertificationDecision, CertificationItem, CertificationItemDetail, DecisionType } from "@/lib/shared/types/compliance";
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
  /** COMPLIANCE-P0-10: agent items still need compliance.manage; a person's access needs only the assigned reviewer. Defaults to true for callers that already required it. */
  canManageCompliance?: boolean;
  /** COMPLIANCE-P0-10 part 2: for defer, the new due date; for exception, the date the access ends. */
  until?: string;
};

/** The decisions an agent's item takes (COMPLIANCE-P0-01); part 2's three are for people's access and roles. */
const AGENT_ITEM_DECISIONS = ["approve", "revoke", "modify", "delegate", "request_information"];

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
  if (item.agentId && input.canManageCompliance === false) throw new ApiError(403, "FORBIDDEN", "Deciding an agent's certification needs compliance.manage");

  let until: string | null = null;
  if (item.agentId) {
    if (!AGENT_ITEM_DECISIONS.includes(input.decision)) throw new ApiError(400, "INVALID_INPUT", "For an agent: approve, revoke, modify, delegate or request_information");
  } else {
    const v = validateUntil(input.decision, input.until, new Date());
    if ("error" in v) throw new ApiError(400, "INVALID_INPUT", v.error);
    until = v.until;
    input = { ...input, until: until ?? undefined };
  }
  // Part 2: escalation goes to whoever launched the campaign.
  let escalateTo: string | null = null;
  if (input.decision === "escalate") {
    const { data: campaign, error: campaignError } = await supabase.from("certification_campaigns").select("created_by").eq("tenant_id", tenantId).eq("id", item.campaignId).maybeSingle();
    if (campaignError) throw new ApiError(500, "QUERY_FAILED", campaignError.message);
    escalateTo = escalationTarget((campaign?.created_by as string | null) ?? null, actorId);
    if (!escalateTo) throw new ApiError(409, "NO_ESCALATION_TARGET", "You launched this campaign; decide the item, or delegate it");
  }

  let snapshot: unknown;
  let remediationId: string | null = null;
  if (item.roleSource) {
    ({ snapshot, remediationId } = await roleItemDecision(tenantId, actorId, item, input));
  } else if (item.identityId) {
    ({ snapshot, remediationId } = await identityItemDecision(tenantId, actorId, item, input));
  } else {
    ({ snapshot, remediationId } = await agentItemDecision(tenantId, actorId, item as CertificationItem & { agentId: string }, input));
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
      until,
    })
    .select()
    .single();
  if (decisionError || !decisionRow) throw new ApiError(500, "CREATE_FAILED", decisionError?.message ?? "Failed to record decision");

  if (input.decision === "delegate") {
    const { error: updateError } = await supabase.from("certification_items").update({ reviewer_id: input.delegateToUserId }).eq("id", itemId);
    if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  } else if (input.decision === "defer") {
    // Part 2: the item stays open with the later due date (and may escalate again once that passes).
    const { error: updateError } = await supabase.from("certification_items").update({ due_date: until, escalated_at: null, escalated_to: null }).eq("tenant_id", tenantId).eq("id", itemId);
    if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  } else if (input.decision === "escalate") {
    const { error: updateError } = await supabase
      .from("certification_items")
      .update({ reviewer_id: escalateTo, escalated_at: new Date().toISOString(), escalated_to: escalateTo })
      .eq("tenant_id", tenantId)
      .eq("id", itemId);
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

/** The agent path (COMPLIANCE-P0-01..04): SoD on approve, revoke the grant, modify as a request. */
async function agentItemDecision(
  tenantId: string,
  actorId: string,
  item: CertificationItem & { agentId: string },
  input: RecordDecisionInput,
): Promise<{ snapshot: unknown; remediationId: string | null }> {
  const itemId = item.id;
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
    // Resolved 2026-09-16: Access Agent published a request_type
    // discriminator (migration 0060) so a reviewer-initiated "modify"
    // creates a real, distinct access_requests row rather than only being
    // recorded in this decision's justification text.
    if (item.accessGrantId) {
      const grant = await getAccessGrant(tenantId, item.accessGrantId);
      const entitlement = grant ? await getEntitlement(tenantId, grant.entitlementId) : null;
      if (entitlement) {
        const request = await createAccessRequest(
          tenantId,
          actorId,
          item.agentId,
          entitlement.applicationId,
          entitlement.id,
          input.justification,
          "modify",
        );
        remediationId = request.id;
      } else {
        await writeAudit({
          tenantId,
          actorId,
          actorType: "user",
          action: "compliance.modify_request_failed",
          objectType: "certification_item",
          objectId: itemId,
          outcome: "failure",
          metadata: { reason: "The item's access_grant_id or its entitlement could not be resolved; no access_requests row was created." },
        });
      }
    } else {
      await writeAudit({
        tenantId,
        actorId,
        actorType: "user",
        action: "compliance.modify_without_specific_grant",
        objectType: "certification_item",
        objectId: itemId,
        outcome: "failure",
        metadata: { reason: "This item has no access_grant_id (not an entitlement-level item) — no specific entitlement to target a modify request at." },
      });
    }
  }
  return { snapshot, remediationId };
}

/**
 * COMPLIANCE-P0-10: a person's access. Nobody certifies their own access;
 * a revoke opens an approved removal in Access (the decision is the human
 * approval, #15), followed to verification at the source like any other.
 */
async function identityItemDecision(tenantId: string, actorId: string, item: CertificationItem, input: RecordDecisionInput): Promise<{ snapshot: unknown; remediationId: string | null }> {
  if (!(IDENTITY_ITEM_DECISIONS as readonly string[]).includes(input.decision)) {
    throw new ApiError(400, "INVALID_INPUT", "For a person's access: approve, revoke, defer, escalate, exception, delegate or request_information");
  }
  const subject = (await getIdentityReviewInfo(tenantId, [item.identityId!])).get(item.identityId!) ?? null;
  if (selfCertificationRefused(input.decision, actorId, subject?.userId ?? null)) {
    await writeAudit({ tenantId, actorId, actorType: "user", action: "compliance.sod_conflict_blocked", objectType: "certification_item", objectId: item.id, outcome: "failure", metadata: { reason: "self-certification" } });
    throw new ApiError(409, "SELF_CERTIFICATION", "Nobody certifies their own access");
  }
  let remediationId: string | null = null;
  if (input.decision === "revoke") {
    if (!item.accessGrantId) throw new ApiError(409, "NO_SPECIFIC_GRANT", "This item names no specific access to remove");
    const request = await requestCertifiedRemoval(tenantId, actorId, { grantId: item.accessGrantId, certificationItemId: item.id, justification: input.justification });
    remediationId = request.id;
  } else if (input.decision === "exception") {
    // Part 2: kept until a date, then removed by Access's daily expiry sweep (time-bound access).
    if (!item.accessGrantId) throw new ApiError(409, "NO_SPECIFIC_GRANT", "This item names no specific access to keep");
    const grant = await getAccessGrant(tenantId, item.accessGrantId);
    if (!grant?.applicationId) throw new ApiError(409, "NO_SPECIFIC_GRANT", "That access no longer exists");
    const kept = await recordApprovedAfterwards(tenantId, actorId, {
      subjectIdentityId: item.identityId!,
      applicationId: grant.applicationId,
      entitlementId: grant.entitlementId ?? null,
      accessGrantId: item.accessGrantId,
      justification: `Access review exception: ${input.justification}`,
      expiresAt: input.until!,
    });
    remediationId = kept.requestId;
  }
  const snapshot = { ...(item.snapshot as Record<string, unknown> | null), decidedAt: new Date().toISOString(), subject: subject ? { displayName: subject.displayName, identityType: subject.identityType } : null };
  return { snapshot, remediationId };
}

/**
 * COMPLIANCE-P0-11: a WonderID role the person holds. Never certified by
 * that person. A revoke removes it now through Foundation's services: the
 * direct assignment (`removeRole`), or the person from the group the role
 * comes from (`removeGroupMember`), before the decision is recorded, so a
 * refused removal (the last administrator, say) records nothing.
 */
async function roleItemDecision(tenantId: string, actorId: string, item: CertificationItem, input: RecordDecisionInput): Promise<{ snapshot: unknown; remediationId: string | null }> {
  if (!(IDENTITY_ITEM_DECISIONS as readonly string[]).includes(input.decision)) {
    throw new ApiError(400, "INVALID_INPUT", "For a role assignment: approve, revoke, defer, escalate, exception, delegate or request_information");
  }
  const subject = (await getIdentityReviewInfo(tenantId, [item.identityId!])).get(item.identityId!) ?? null;
  if (selfCertificationRefused(input.decision, actorId, subject?.userId ?? null)) {
    await writeAudit({ tenantId, actorId, actorType: "user", action: "compliance.sod_conflict_blocked", objectType: "certification_item", objectId: item.id, outcome: "failure", metadata: { reason: "self-certification" } });
    throw new ApiError(409, "SELF_CERTIFICATION", "Nobody certifies their own access");
  }
  const role = item.snapshot?.role;
  if (input.decision === "revoke") {
    if (!subject?.userId || !role) throw new ApiError(409, "NO_SPECIFIC_GRANT", "This item names no role assignment to remove");
    if (item.roleSource === "group") {
      if (!item.groupId) throw new ApiError(409, "GROUP_GONE", "The group this role came from no longer exists");
      await removeGroupMember(tenantId, actorId, item.groupId, subject.userId);
    } else {
      await removeRole(tenantId, actorId, subject.userId, role.name);
    }
  } else if (input.decision === "exception") {
    // Part 2: a direct role is kept until a date (its own end date); a group's role cannot end for one member.
    if (!subject?.userId || !item.roleId) throw new ApiError(409, "NO_SPECIFIC_GRANT", "This item names no role assignment to keep");
    if (item.roleSource === "group") throw new ApiError(409, "GROUP_ROLE", "A role that comes from a group can't end for one person; certify or revoke it");
    await setRoleAssignmentEnd(tenantId, actorId, subject.userId, item.roleId, input.until!);
  }
  if (input.decision === "approve" || input.decision === "revoke" || input.decision === "exception") {
    await writeAudit({
      tenantId,
      actorId,
      actorType: "user",
      action: input.decision === "approve" ? "compliance.access_certified" : input.decision === "exception" ? "compliance.access_exception" : "compliance.access_revoked",
      objectType: "certification_item",
      objectId: item.id,
      outcome: "success",
      metadata: { userId: subject?.userId ?? null, role: role?.name ?? null, source: item.roleSource, groupId: item.groupId, campaignId: item.campaignId, until: input.until ?? null },
    });
  }
  const snapshot = { ...(item.snapshot as Record<string, unknown> | null), decidedAt: new Date().toISOString(), subject: subject ? { displayName: subject.displayName, identityType: subject.identityType } : null };
  return { snapshot, remediationId: null };
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
