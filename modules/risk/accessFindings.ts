import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AccessFinding, FindingStatus, ResolutionType, RiskSeverity, RogueAccess } from "@/lib/shared/types/risk";
import {
  authorizationJustification,
  decidesOwnAccess,
  exceptionEnded,
  rogueResolution,
  rogueTrend,
  validateRogueAuthorization,
  validateRogueDecision,
  type RogueAuthorizationInput,
  type RogueDecisionInput,
  type RogueResolution,
  type RogueTrendWeek,
} from "./accessFindingRules";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { rogueSeverity, type RogueFacts, type RogueSeverity } from "./rogueSeverity";

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

/** §15: one page of open rogue-access findings, newest first, paged in the database, with the total. */
export async function listOpenAccessFindingsPage(tenantId: string, opts: { page?: number; pageSize?: number } = {}): Promise<{ rows: AccessFinding[]; total: number }> {
  const pageSize = Math.min(Math.max(Math.trunc(opts.pageSize ?? 50) || 50, 1), 200);
  const page = Math.max(Math.trunc(opts.page ?? 1) || 1, 1);
  const { data, error, count } = await supabaseServiceRole()
    .from("risk_findings")
    .select(`*, ${TICKET}`, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("category", "rogue_access")
    .in("status", OPEN)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return { rows: ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map(toAccessFinding), total: count ?? 0 };
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

/**
 * RISK-P0-13: the rogue-access trend for the last `weeks` weeks. Reads only
 * findings that could count (still open, or resolved inside the window), the
 * two dates of each, filtered on the tenant; bounded.
 */
export async function getRogueAccessTrend(tenantId: string, weeks = 8, now = new Date()): Promise<RogueTrendWeek[]> {
  const since = new Date(now.getTime() - (weeks * 7 + 7) * 86_400_000).toISOString();
  const { data, error } = await supabaseServiceRole()
    .from("risk_findings")
    .select("tenant_id, created_at, resolved_at")
    .eq("tenant_id", tenantId)
    .eq("category", "rogue_access")
    .or(`resolved_at.is.null,resolved_at.gte.${since}`)
    .limit(5000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => ({ createdAt: r.created_at as string, resolvedAt: (r.resolved_at as string | null) ?? null }));
  return rogueTrend(rows, now, weeks);
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
 * RISK-P0-13: the facts each piece of rogue access is scored on (entitlement
 * privilege and data, account type, the identity holding it, other rogue
 * access on the account), read with the service role and filtered on the
 * tenant (§14). A fact that cannot be read leaves the base severity.
 */
async function severitiesFor(tenantId: string, rogue: RogueAccess[]): Promise<Map<string, RogueSeverity>> {
  const admin = supabaseServiceRole();
  const read = async (table: string, columns: string, ids: string[]) => {
    const out = new Map<string, Row>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 200) {
      const { data } = await admin.from(table).select(`id, tenant_id, ${columns}`).eq("tenant_id", tenantId).in("id", unique.slice(i, i + 200));
      for (const r of (data ?? []) as unknown as Row[]) if (r.tenant_id === tenantId) out.set(r.id as string, r);
    }
    return out;
  };
  const [entitlements, accounts, identities] = await Promise.all([
    read("entitlements", "privilege_level, data_classification", rogue.map((r) => r.entitlementId).filter((x): x is string => !!x)),
    read("accounts", "account_type", rogue.map((r) => r.accountId)),
    read("identities", "identity_type, status", rogue.map((r) => r.identityId).filter((x): x is string => !!x)),
  ]);
  const perAccount = new Map<string, number>();
  for (const r of rogue) perAccount.set(r.accountId, (perAccount.get(r.accountId) ?? 0) + 1);
  const out = new Map<string, RogueSeverity>();
  for (const r of rogue) {
    const e = r.entitlementId ? entitlements.get(r.entitlementId) : undefined;
    const who = r.identityId ? identities.get(r.identityId) : undefined;
    const facts: RogueFacts = {
      privilegeLevel: (e?.privilege_level as RogueFacts["privilegeLevel"] | undefined) ?? null,
      accountType: (accounts.get(r.accountId)?.account_type as RogueFacts["accountType"] | undefined) ?? null,
      dataClassification: (e?.data_classification as string | null | undefined) ?? null,
      identityType: r.identityId ? ((who?.identity_type as string | undefined) ?? "UNKNOWN") : null,
      identityStatus: (who?.status as string | undefined) ?? null,
      otherRogueOnAccount: (perAccount.get(r.accountId) ?? 1) - 1,
    };
    out.set(accessSubjectKey(r.accountId, r.entitlementId), rogueSeverity(facts));
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
  const openScore = new Map<string, number | null>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("risk_findings")
      .select("id, tenant_id, subject_key, risk_score")
      .eq("tenant_id", tenantId)
      .eq("category", "rogue_access")
      .in("status", OPEN)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    for (const r of (data ?? []) as Row[]) {
      if (r.tenant_id !== tenantId || !r.subject_key) continue;
      open.set(r.subject_key as string, r.id as string);
      openScore.set(r.id as string, (r.risk_score as number | null) ?? null);
    }
    if (!data || data.length < PAGE) break;
  }

  const wanted = new Map(rogue.map((r) => [accessSubjectKey(r.accountId, r.entitlementId), r]));
  const severities = await severitiesFor(tenantId, rogue);
  const rescored: string[] = [];
  const result = { created: 0, resolved: 0, failed: 0 };
  const createdIds: string[] = [];
  const resolvedIds: string[] = [];
  const createdTickets: string[] = [];
  const resolvedTickets: string[] = [];

  for (const [key, r] of wanted) {
    const sev = severities.get(key) ?? rogueSeverity({ privilegeLevel: null, accountType: null, dataClassification: null, identityType: "UNKNOWN", identityStatus: null, otherRogueOnAccount: 0 });
    const openId = open.get(key);
    if (openId) {
      // RISK-P0-13: an open finding follows its facts (a person leaving, a privilege added).
      if (openScore.get(openId) !== sev.score) {
        const { error } = await admin
          .from("risk_findings")
          .update({ severity: sev.severity, risk_score: sev.score, reasons: sev.reasons, updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("id", openId)
          .in("status", OPEN);
        if (error) result.failed++;
        else rescored.push(openId);
      }
      continue;
    }
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
        severity: sev.severity,
        risk_score: sev.score,
        reasons: sev.reasons,
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

  if (createdIds.length || resolvedIds.length || rescored.length) {
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
        rescored: rescored.slice(0, 500),
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

/** One open rogue-access finding of this organization, or a refusal in words. */
async function loadOpenRogueFinding(tenantId: string, findingId: string): Promise<Row> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(findingId)) throw new ApiError(404, "FINDING_NOT_FOUND");
  const { data: finding, error } = await supabaseServiceRole()
    .from("risk_findings")
    .select(`*, ${TICKET}`)
    .eq("tenant_id", tenantId)
    .eq("id", findingId)
    .eq("category", "rogue_access")
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!finding || finding.tenant_id !== tenantId) throw new ApiError(404, "FINDING_NOT_FOUND");
  if (!OPEN.includes(finding.status as FindingStatus) || finding.status === "exception") throw new ApiError(409, "FINDING_CLOSED", "This finding is already closed or excepted");
  return finding as Row;
}

/**
 * RISK-P0-13 — approve rogue access afterwards, as it stands, or recognize
 * it as legacy access; optionally until a date (time-bound). The approval
 * is recorded by Access as a request (recordApprovedAfterwards), so the
 * ledger counts the access as approved from now on, and the finding closes
 * as approved afterwards with that request as its evidence. Someone other
 * than the account's owner decides (risk.manage, checked by the caller).
 */
export async function authorizeRogueFinding(tenantId: string, actorId: string, findingId: string, input: RogueAuthorizationInput, now = new Date()): Promise<AccessFinding> {
  const authorization = validateRogueAuthorization(input, now);
  if ("error" in authorization) throw new ApiError(400, "VALIDATION_FAILED", authorization.error);
  const finding = await loadOpenRogueFinding(tenantId, findingId);
  const identityId = (finding.identity_id as string | null) ?? null;
  const applicationId = (finding.application_id as string | null) ?? null;
  if (!applicationId) throw new ApiError(409, "NO_APPLICATION", "This access is not tied to an application WonderID manages");
  if (!identityId) throw new ApiError(409, "ACCOUNT_UNLINKED", "Link the account to its identity first; an approval is given to someone");
  const decider = await getIdentityForUser(tenantId, actorId);
  if (decidesOwnAccess(decider?.id ?? null, identityId)) throw new ApiError(403, "SELF_DECISION", "Someone other than the account's owner approves its access");

  const ticketNumber = ((finding.ticket as Row | null)?.ticket_number as string | undefined) ?? null;
  const entitlementId = (finding.entitlement_id as string | null) ?? null;
  const { recordApprovedAfterwards, listAssignments, addPackageResource } = await import("@/modules/access-governance/service");
  let packageName: string | null = null;
  let expiresAt = authorization.until;
  if (authorization.kind === "package") {
    // Only a package the identity already holds: adding the access to it gives nobody new access.
    const held = await listAssignments(tenantId, { identityId, packageId: authorization.packageId, live: true, pageSize: 1 });
    if (!held.rows.length) throw new ApiError(409, "PACKAGE_NOT_HELD", "Choose a package this identity already holds");
    packageName = held.rows[0].packageName;
    // The approval ends when the package assignment does.
    expiresAt = held.rows[0].expiresAt;
    try {
      await addPackageResource(tenantId, actorId, authorization.packageId!, { applicationId, entitlementId });
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "DUPLICATE")) throw err;
    }
  }
  const { requestId } = await recordApprovedAfterwards(
    tenantId,
    actorId,
    {
      subjectIdentityId: identityId,
      applicationId,
      entitlementId,
      accessGrantId: (finding.access_grant_id as string | null) ?? null,
      justification: authorizationJustification(authorization, ticketNumber, packageName),
      expiresAt,
    },
    now,
  );

  const admin = supabaseServiceRole();
  const decidedAt = now.toISOString();
  const what = authorization.kind === "legacy" ? "Recognized as legacy access" : authorization.kind === "package" ? `Added to the access package ${packageName ?? ""}`.trimEnd() : "Approved afterwards";
  const reason = `${what}: ${authorization.reason}`;
  const { data: updated, error: updateError } = await admin
    .from("risk_findings")
    .update({
      status: "resolved",
      resolution_type: "approved_afterwards",
      resolution_reason: reason.slice(0, 1000),
      resolved_at: decidedAt,
      decision_reason: authorization.reason,
      decided_by: actorId,
      decided_at: decidedAt,
      exception_until: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", findingId)
    .eq("status", finding.status as string)
    .select(`*, ${TICKET}`)
    .maybeSingle();
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  // The approval stands either way; the next ledger refresh closes a finding that changed meanwhile.
  if (!updated) throw new ApiError(409, "CONFLICT", "The approval was recorded, but the finding changed meanwhile; reload");
  await admin.from("risk_evidence").insert({ finding_id: findingId, evidence_type: "access_request", reference_id: requestId, summary: what });
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.access_finding_authorized",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: "success",
    metadata: { kind: authorization.kind, until: expiresAt, requestId, packageId: authorization.packageId ?? null, fromStatus: finding.status },
    typedText: { reason: authorization.reason },
  });
  return toAccessFinding(updated as Row);
}

/** RISK-P0-13 — give a rogue-access finding an owner: an active member of the organization, or nobody. */
export async function assignRogueFinding(tenantId: string, actorId: string, findingId: string, assigneeId: string | null): Promise<AccessFinding> {
  const finding = await loadOpenRogueFinding(tenantId, findingId);
  const admin = supabaseServiceRole();
  if (assigneeId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assigneeId)) throw new ApiError(400, "VALIDATION_FAILED", "assigneeId: a member");
    const { data: member, error } = await admin.from("tenant_memberships").select("tenant_id").eq("tenant_id", tenantId).eq("user_id", assigneeId).eq("status", "active").maybeSingle();
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    if (!member || member.tenant_id !== tenantId) throw new ApiError(404, "ASSIGNEE_NOT_FOUND", "That person is not a member of this organization");
  }
  const status = assigneeId && ["open", "acknowledged"].includes(finding.status as string) ? "assigned" : (finding.status as string);
  const { data: updated, error: updateError } = await admin
    .from("risk_findings")
    .update({ assigned_to: assigneeId, status })
    .eq("tenant_id", tenantId)
    .eq("id", findingId)
    .eq("status", finding.status as string)
    .select(`*, ${TICKET}`)
    .maybeSingle();
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  if (!updated) throw new ApiError(409, "CONFLICT", "The finding changed meanwhile; reload");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "risk.finding_assigned", objectType: "risk_finding", objectId: findingId, outcome: "success", metadata: { assigneeId, fromStatus: finding.status } });
  return toAccessFinding(updated as Row);
}

/**
 * RISK-P0-13 — escalate a rogue-access finding: it opens an investigation
 * (RISK-P0-11) holding the finding, at a priority from its severity, and
 * the finding moves to investigating. Returns the investigation.
 */
export async function escalateRogueFinding(tenantId: string, actorId: string, findingId: string): Promise<{ investigationId: string; reference: string }> {
  const finding = await loadOpenRogueFinding(tenantId, findingId);
  const { createInvestigation } = await import("./investigations");
  const ticket = ((finding.ticket as Row | null)?.ticket_number as string | undefined) ?? null;
  const investigation = await createInvestigation(tenantId, actorId, {
    title: `${ticket ? `${ticket}: ` : ""}${finding.title as string}`.slice(0, 200),
    summary: `Escalated from a rogue-access finding. ${finding.explanation as string}`.slice(0, 2000),
    findingIds: [findingId],
  });
  const { error } = await supabaseServiceRole()
    .from("risk_findings")
    .update({ status: "investigating" })
    .eq("tenant_id", tenantId)
    .eq("id", findingId)
    .in("status", ["open", "acknowledged", "assigned"]);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  await writeAudit({ tenantId, actorId, actorType: "user", action: "risk.access_finding_escalated", objectType: "risk_finding", objectId: findingId, outcome: "success", metadata: { investigationId: investigation.id, reference: investigation.reference } });
  return { investigationId: investigation.id, reference: investigation.reference };
}

/** RISK-P0-13 — one rogue-access finding with its evidence, for its own page. */
export async function getRogueFinding(tenantId: string, findingId: string): Promise<(AccessFinding & { reasons: string[]; riskScore: number | null; assignedTo: string | null; evidence: { type: string; referenceId: string | null; summary: string | null; createdAt: string }[] }) | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(findingId)) return null;
  // The member's own client: RLS scopes it to their organizations as well (§14).
  const supabase = await supabaseServer();
  const [{ data, error }, { data: evidence }] = await Promise.all([
    supabase.from("risk_findings").select(`*, ${TICKET}`).eq("tenant_id", tenantId).eq("id", findingId).eq("category", "rogue_access").maybeSingle(),
    supabase.from("risk_evidence").select("evidence_type, reference_id, summary, created_at").eq("finding_id", findingId).order("created_at", { ascending: true }).limit(50),
  ]);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) return null;
  let requestStatus: string | null = null;
  if (data.remediation_request_id) {
    const { data: req } = await supabase.from("access_requests").select("status").eq("tenant_id", tenantId).eq("id", data.remediation_request_id).maybeSingle();
    requestStatus = (req?.status as string | undefined) ?? null;
  }
  return {
    ...toAccessFinding(data as Row),
    remediationRequestStatus: requestStatus,
    reasons: Array.isArray(data.reasons) ? (data.reasons as string[]) : [],
    riskScore: (data.risk_score as number | null) ?? null,
    assignedTo: (data.assigned_to as string | null) ?? null,
    evidence: ((evidence ?? []) as Row[]).map((e) => ({ type: e.evidence_type as string, referenceId: (e.reference_id as string | null) ?? null, summary: (e.summary as string | null) ?? null, createdAt: e.created_at as string })),
  };
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

/** IDENTITY-P0-17 — one finding about an identity, for its Risk tab. */
export type IdentityFindingSummary = { id: string; category: string; severity: RiskSeverity; status: FindingStatus; title: string; ticketNumber: string | null; agentId: string | null; createdAt: string };

/**
 * IDENTITY-P0-17 — the findings about one identity: its accounts' rogue
 * access, and, for an AI agent's identity, the agent's own findings. Open
 * first, newest first; bounded. The member's own client (RLS to their
 * organizations) plus the tenant filter (§14).
 */
export async function listIdentityFindings(tenantId: string, subject: { identityId: string; agentId: string | null }, limit = 100): Promise<IdentityFindingSummary[]> {
  const supabase = await supabaseServer();
  const or = subject.agentId ? `identity_id.eq.${subject.identityId},agent_id.eq.${subject.agentId}` : `identity_id.eq.${subject.identityId}`;
  if (!/^[0-9a-f-]{36}$/i.test(subject.identityId) || (subject.agentId && !/^[0-9a-f-]{36}$/i.test(subject.agentId))) return [];
  const { data, error } = await supabase
    .from("risk_findings")
    .select(`id, category, severity, status, title, agent_id, created_at, ${TICKET}`)
    .eq("tenant_id", tenantId)
    .or(or)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = ((data ?? []) as Row[]).map((r) => ({
    id: r.id as string,
    category: r.category as string,
    severity: r.severity as RiskSeverity,
    status: r.status as FindingStatus,
    title: r.title as string,
    ticketNumber: ((r.ticket as Row | null)?.ticket_number as string | undefined) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
  const open = (s: FindingStatus) => OPEN.includes(s);
  return rows.sort((a, b) => Number(open(b.status)) - Number(open(a.status)));
}
