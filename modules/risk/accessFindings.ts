import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AccessFinding, FindingStatus, ResolutionType, RiskSeverity, RogueAccess } from "@/lib/shared/types/risk";
import { decidesOwnAccess, exceptionEnded, rogueResolution, validateRogueDecision, type RogueDecisionInput, type RogueResolution } from "./accessFindingRules";
import { getIdentityForUser } from "@/modules/agent-identity/service";

/**
 * ACCESS-P0-25 — findings about access on an application account (a
 * person's, an external person's, a service account's or an agent's): today
 * rogue access, i.e. access that appeared on the target after the
 * application's baseline with no WonderID approval behind it.
 *
 * Access decides what is rogue (its ledger) and reports the complete current
 * set for the organization; this keeps exactly one open finding per account
 * and entitlement for it, creates one for anything newly rogue and resolves
 * the open ones that are no longer rogue (an approval appeared, or the
 * access was removed or revoked). Remediation is RISK-P0-13 (F3).
 *
 * Each rogue account has one ticket (RA-000001, per organization) that
 * holds every rogue-access finding on it (migration 0132). The database
 * opens it with the account's first finding and resolves it when the last
 * one closes, i.e. once the account is remediated.
 *
 * Findings are evidentiary: written with the service role only (no client
 * write policy, 0034), every statement filtered on `tenantId` (§14).
 */

const PAGE = 1000;
/** The account's ticket, embedded through the same-tenant key. */
const TICKET = "ticket:risk_access_tickets!risk_findings_access_ticket_fkey(ticket_number, status)";
const OPEN: FindingStatus[] = ["open", "acknowledged", "investigating", "assigned", "remediation_in_progress", "mitigated", "exception"];

/** The finding key for one account, or one entitlement of it. */
export function accessSubjectKey(accountId: string, entitlementId: string | null): string {
  return `${accountId}|${entitlementId ?? ""}`;
}

type Row = Record<string, unknown>;

function toAccessFinding(r: Row): AccessFinding {
  return {
    id: r.id as string,
    ticketNumber: ((r.ticket as Row | null)?.ticket_number as string | undefined) ?? null,
    ticketStatus: ((r.ticket as Row | null)?.status as "open" | "resolved" | undefined) ?? null,
    category: "rogue_access",
    severity: r.severity as RiskSeverity,
    status: r.status as FindingStatus,
    title: r.title as string,
    explanation: r.explanation as string,
    recommendation: r.recommendation as string,
    accountId: r.account_id as string,
    entitlementId: (r.entitlement_id as string | null) ?? null,
    accessGrantId: (r.access_grant_id as string | null) ?? null,
    applicationId: (r.application_id as string | null) ?? null,
    identityId: (r.identity_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    createdAt: r.created_at as string,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolutionType: (r.resolution_type as ResolutionType | null) ?? null,
    resolutionReason: (r.resolution_reason as string | null) ?? null,
    remediationRequestId: (r.remediation_request_id as string | null) ?? null,
    remediationRequestStatus: null,
    exceptionUntil: (r.exception_until as string | null) ?? null,
    decisionReason: (r.decision_reason as string | null) ?? null,
  };
}

/** An account's access findings, open first (for the account page). */
export async function listAccessFindings(tenantId: string, filter: { accountId?: string; openOnly?: boolean } = {}): Promise<AccessFinding[]> {
  let q = supabaseServiceRole().from("risk_findings").select(`*, ${TICKET}`).eq("tenant_id", tenantId).eq("category", "rogue_access");
  if (filter.accountId) q = q.eq("account_id", filter.accountId);
  if (filter.openOnly) q = q.in("status", OPEN);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const findings = ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map(toAccessFinding);
  // RISK-P0-13: where each removal request stands.
  const requestIds = [...new Set(findings.map((f) => f.remediationRequestId).filter((x): x is string => !!x))];
  if (requestIds.length) {
    const { data: requests } = await supabaseServiceRole().from("access_requests").select("id, tenant_id, status").eq("tenant_id", tenantId).in("id", requestIds);
    const status = new Map(((requests ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => [r.id as string, r.status as string]));
    for (const f of findings) f.remediationRequestStatus = f.remediationRequestId ? (status.get(f.remediationRequestId) ?? null) : null;
  }
  return findings;
}

/**
 * How many rogue-access findings are open, for the Intelligence badge: a
 * count only, read as the member under RLS and filtered on the tenant.
 * Unreadable counts as 0 so the shell never fails on it.
 */
export async function countOpenAccessFindings(tenantId: string): Promise<number> {
  const supabase = await supabaseServer();
  const { count, error } = await supabase
    .from("risk_findings")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("category", "rogue_access")
    .eq("status", "open");
  return error ? 0 : (count ?? 0);
}

/** How each finding ended, from its grant now. A grant that cannot be read counts as gone only when it is truly absent. */
async function resolutionsFor(tenantId: string, findingIds: string[]): Promise<Map<string, RogueResolution>> {
  const out = new Map<string, RogueResolution>();
  const admin = supabaseServiceRole();
  for (let i = 0; i < findingIds.length; i += 200) {
    const part = findingIds.slice(i, i + 200);
    const { data: findings, error } = await admin.from("risk_findings").select("id, tenant_id, access_grant_id").eq("tenant_id", tenantId).in("id", part);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const own = ((findings ?? []) as Row[]).filter((f) => f.tenant_id === tenantId);
    const grantIds = own.map((f) => f.access_grant_id as string | null).filter((g): g is string => !!g);
    const grants = new Map<string, Row>();
    if (grantIds.length) {
      const { data, error: grantError } = await admin
        .from("access_grants")
        .select("id, tenant_id, revoked_at, missing_from_source_at, request_id, access_package_assignment_item_id")
        .eq("tenant_id", tenantId)
        .in("id", grantIds);
      if (grantError) throw new ApiError(500, "QUERY_FAILED", grantError.message);
      for (const g of (data ?? []) as Row[]) if (g.tenant_id === tenantId) grants.set(g.id as string, g);
    }
    for (const f of own) {
      const g = f.access_grant_id ? grants.get(f.access_grant_id as string) : undefined;
      out.set(
        f.id as string,
        rogueResolution(
          g
            ? {
                revokedAt: (g.revoked_at as string | null) ?? null,
                missingFromSourceAt: (g.missing_from_source_at as string | null) ?? null,
                requestId: (g.request_id as string | null) ?? null,
                packageItemId: (g.access_package_assignment_item_id as string | null) ?? null,
              }
            : null,
        ),
      );
    }
  }
  return out;
}

/**
 * Brings the organization's open rogue-access findings in line with
 * `rogue`, the complete set Access found rogue just now. Returns what
 * changed. Never throws for one bad row: a finding that cannot be written is
 * counted as failed and the rest go on.
 */
export async function syncRogueAccessFindings(tenantId: string, rogue: RogueAccess[]): Promise<{ created: number; resolved: number; failed: number }> {
  const admin = supabaseServiceRole();
  // WID-H04: an accepted exception that has ended is open again.
  await reopenEndedExceptions(tenantId);
  // WID-H04: a grant a person closed as a false positive is not flagged again.
  const falsePositive = new Set<string>();
  {
    const { data, error } = await admin
      .from("risk_findings")
      .select("tenant_id, subject_key, access_grant_id")
      .eq("tenant_id", tenantId)
      .eq("category", "rogue_access")
      .eq("status", "false_positive")
      .not("access_grant_id", "is", null)
      .limit(5000);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    for (const r of (data ?? []) as Row[]) if (r.tenant_id === tenantId) falsePositive.add(`${r.subject_key}|${r.access_grant_id}`);
  }
  const open = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("risk_findings")
      .select("id, tenant_id, subject_key")
      .eq("tenant_id", tenantId)
      .eq("category", "rogue_access")
      .in("status", OPEN)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    for (const r of (data ?? []) as Row[]) if (r.tenant_id === tenantId && r.subject_key) open.set(r.subject_key as string, r.id as string);
    if (!data || data.length < PAGE) break;
  }

  const wanted = new Map(rogue.map((r) => [accessSubjectKey(r.accountId, r.entitlementId), r]));
  const result = { created: 0, resolved: 0, failed: 0 };
  const createdIds: string[] = [];
  const resolvedIds: string[] = [];
  const createdTickets: string[] = [];
  const resolvedTickets: string[] = [];

  for (const [key, r] of wanted) {
    if (open.has(key)) continue;
    if (r.accessGrantId && falsePositive.has(`${key}|${r.accessGrantId}`)) continue;
    const { data, error } = await admin
      .from("risk_findings")
      .insert({
        tenant_id: tenantId,
        agent_id: r.agentId,
        identity_id: r.identityId,
        account_id: r.accountId,
        entitlement_id: r.entitlementId,
        access_grant_id: r.accessGrantId,
        application_id: r.applicationId,
        subject_key: key,
        category: "rogue_access",
        severity: "high",
        risk_score: 70,
        reasons: ["Appeared after the application's baseline", "No WonderID approval found"],
        title: `Rogue access: ${r.label}`.slice(0, 300),
        explanation: `This access was first seen on ${r.firstSeenAt.slice(0, 10)}, after WonderID's baseline for the application (${r.baselineAt.slice(0, 10)}), and no request, access package or administrator grant in WonderID covers it.`,
        recommendation: "Find out who granted it. Request it through WonderID if it is needed, or have it removed on the target.",
      })
      .select(`id, access_ticket_id, ${TICKET}`)
      .single();
    // 23505: another refresh opened the same finding first; that one stands.
    if (error?.code === "23505") continue;
    if (error || !data) {
      result.failed++;
      continue;
    }
    result.created++;
    createdIds.push(data.id as string);
    const ticket = (data as Row).ticket as Row | null;
    if (ticket?.ticket_number) createdTickets.push(ticket.ticket_number as string);
    if (r.accessGrantId) {
      await admin.from("risk_evidence").insert({ finding_id: data.id, evidence_type: "access_grant", reference_id: r.accessGrantId, summary: `Grant ${r.label}, no WonderID approval` });
    }
  }

  // WID-H04: each stale finding closes as what happened to its grant: removed, or approved afterwards.
  const stale = [...open.entries()].filter(([key]) => !wanted.has(key)).map(([, id]) => id);
  const outcomes = await resolutionsFor(tenantId, stale);
  const approvedAfterwards: string[] = [];
  const resolvedAt = new Date().toISOString();
  for (const [id, outcome] of outcomes) {
    const { data, error } = await admin
      .from("risk_findings")
      .update({ status: "resolved", resolution_type: outcome.type, resolution_reason: outcome.reason, resolved_at: resolvedAt })
      .eq("tenant_id", tenantId)
      .eq("category", "rogue_access")
      .eq("id", id)
      .in("status", OPEN)
      .select(`id, ${TICKET}`);
    if (error) {
      result.failed++;
      continue;
    }
    if (!data?.length) continue;
    result.resolved++;
    resolvedIds.push(id);
    if (outcome.type === "approved_afterwards") approvedAfterwards.push(id);
    if (outcome.requestId) {
      await admin.from("risk_evidence").insert({ finding_id: id, evidence_type: "access_request", reference_id: outcome.requestId, summary: "The request that approved it afterwards" });
    }
    // The trigger resolves an account's ticket when its last finding closes: name those.
    const t = (data[0] as Row).ticket as Row | null;
    if (t?.status === "resolved" && t.ticket_number) resolvedTickets.push(t.ticket_number as string);
  }

  if (createdIds.length || resolvedIds.length) {
    await writeAudit({
      tenantId,
      actorType: "system",
      action: "risk.access_findings_synced",
      objectType: "tenant",
      objectId: tenantId,
      outcome: result.failed ? "failure" : "success",
      metadata: {
        created: createdIds.slice(0, 500),
        resolved: resolvedIds.slice(0, 500),
        approvedAfterwards: approvedAfterwards.slice(0, 500),
        tickets: [...new Set(createdTickets)].slice(0, 500),
        ticketsResolved: [...new Set(resolvedTickets)].slice(0, 500),
        failed: result.failed,
      },
    });
  }
  return result;
}

/**
 * WID-H04 (owner decision 2026-10-12): a person closes a rogue-access
 * finding without removing the access: an accepted exception (a reason and
 * an end at most 90 days away; it reopens then) or a false positive (a
 * reason; the same grant is not flagged again). Someone other than the
 * account's owner decides. Service role (findings have no client write
 * policy); every statement is filtered on `tenantId`; audited.
 */
export async function decideRogueFinding(tenantId: string, actorId: string, findingId: string, input: RogueDecisionInput, now = new Date()): Promise<AccessFinding> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(findingId)) throw new ApiError(404, "FINDING_NOT_FOUND");
  const decision = validateRogueDecision(input, now);
  if ("error" in decision) throw new ApiError(400, "VALIDATION_FAILED", decision.error);
  const admin = supabaseServiceRole();
  const { data: finding, error } = await admin
    .from("risk_findings")
    .select("id, tenant_id, status, identity_id")
    .eq("tenant_id", tenantId)
    .eq("id", findingId)
    .eq("category", "rogue_access")
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!finding || finding.tenant_id !== tenantId) throw new ApiError(404, "FINDING_NOT_FOUND");
  if (!OPEN.includes(finding.status as FindingStatus)) throw new ApiError(409, "FINDING_CLOSED", "This finding is already closed");
  const decider = await getIdentityForUser(tenantId, actorId);
  if (decidesOwnAccess(decider?.id ?? null, (finding.identity_id as string | null) ?? null)) {
    throw new ApiError(403, "SELF_DECISION", "Someone other than the account's owner decides on its access");
  }
  const decidedAt = now.toISOString();
  const set =
    decision.outcome === "exception"
      ? { status: "exception", exception_until: decision.until, decision_reason: decision.reason, decided_by: actorId, decided_at: decidedAt }
      : { status: "false_positive", resolution_type: "false_positive", resolution_reason: decision.reason, resolved_at: decidedAt, exception_until: null, decision_reason: decision.reason, decided_by: actorId, decided_at: decidedAt };
  const { data: updated, error: updateError } = await admin
    .from("risk_findings")
    .update(set)
    .eq("tenant_id", tenantId)
    .eq("id", findingId)
    .eq("status", finding.status as string)
    .select(`*, ${TICKET}`)
    .maybeSingle();
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  if (!updated) throw new ApiError(409, "CONFLICT", "The finding changed meanwhile; reload");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.access_finding_decided",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: "success",
    metadata: { outcome: decision.outcome, until: decision.until, fromStatus: finding.status },
    // WID-H07: the reason stays on the finding (decision_reason).
    typedText: { reason: decision.reason },
  });
  return toAccessFinding(updated as Row);
}

/** WID-H04: accepted exceptions whose end has passed are open again. Returns how many. */
export async function reopenEndedExceptions(tenantId: string, now = new Date()): Promise<number> {
  const admin = supabaseServiceRole();
  const { data, error } = await admin
    .from("risk_findings")
    .select("id, tenant_id, exception_until")
    .eq("tenant_id", tenantId)
    .eq("category", "rogue_access")
    .eq("status", "exception")
    .lte("exception_until", now.toISOString())
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const ended = ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId && exceptionEnded((r.exception_until as string | null) ?? null, now)).map((r) => r.id as string);
  if (!ended.length) return 0;
  const { data: reopened, error: updateError } = await admin
    .from("risk_findings")
    .update({ status: "open", exception_until: null })
    .eq("tenant_id", tenantId)
    .eq("status", "exception")
    .in("id", ended)
    .select("id");
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  const ids = ((reopened ?? []) as Row[]).map((r) => r.id as string);
  if (ids.length) {
    await writeAudit({ tenantId, actorType: "system", action: "risk.access_finding_exception_ended", objectType: "tenant", objectId: tenantId, outcome: "success", metadata: { reopened: ids.slice(0, 500) } });
  }
  return ids.length;
}
