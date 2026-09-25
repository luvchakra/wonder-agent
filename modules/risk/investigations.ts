import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type {
  FindingStatus,
  Investigation,
  InvestigationDetail,
  InvestigationEvent,
  InvestigationEventType,
  InvestigationPriority,
  InvestigationStatus,
  InvestigationSummary,
  RiskSeverity,
} from "@/lib/shared/types/risk";
import { toRiskEvidence, toRiskFinding } from "./mappers";
import { formatReference, isFindingOpen, nextSequence, priorityFromSeverities, transitionBlocker, worstSeverity } from "./investigationRules";

/**
 * RISK-P0-11 (master P0-37) — investigations.
 *
 * Reads run as the calling user under RLS (select-only policies, 0071).
 * Writes use the service role, like risk_findings, behind risk.manage in
 * the caller; so every write here filters by tenant_id and re-checks each
 * referenced row's tenant before touching it (§14). The database also
 * refuses a cross-tenant link through composite foreign keys.
 *
 * Every change writes a timeline row (investigation_events) and an audit
 * event (#11). An investigation never changes its findings' own state.
 */

const PRIORITIES: InvestigationPriority[] = ["critical", "high", "medium", "low"];
const MAX_FINDINGS = 50;

type InvestigationRow = {
  id: string;
  tenant_id: string;
  reference: string;
  title: string;
  summary: string | null;
  status: InvestigationStatus;
  priority: InvestigationPriority;
  assignee_id: string | null;
  created_by: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

function toInvestigation(r: InvestigationRow): Investigation {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    reference: r.reference,
    title: r.title,
    summary: r.summary,
    status: r.status,
    priority: r.priority,
    assigneeId: r.assignee_id,
    createdBy: r.created_by,
    resolution: r.resolution,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}

const text = (v: unknown, max: number, field: string, required = false): string | null => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ApiError(400, "VALIDATION_FAILED", `${field}: required`);
    return null;
  }
  if (typeof v !== "string" || v.trim().length > max) throw new ApiError(400, "VALIDATION_FAILED", `${field}: text of at most ${max} characters`);
  return v.trim() || null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** This tenant's findings by id, re-checked (service role, §14). Throws 404 if any is missing. */
async function loadTenantFindings(tenantId: string, findingIds: string[]) {
  if (findingIds.some((id) => !UUID.test(id))) throw new ApiError(400, "VALIDATION_FAILED", "findingIds: must be UUIDs");
  const { data, error } = await supabaseServiceRole().from("risk_findings").select("id, tenant_id, severity, status").eq("tenant_id", tenantId).in("id", findingIds);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = ((data ?? []) as Array<{ id: string; tenant_id: string; severity: RiskSeverity; status: FindingStatus }>).filter((r) => r.tenant_id === tenantId);
  if (rows.length !== new Set(findingIds).size) throw new ApiError(404, "FINDING_NOT_FOUND", "One or more findings were not found");
  return rows;
}

async function assertMember(tenantId: string, userId: string) {
  if (!UUID.test(userId)) throw new ApiError(400, "VALIDATION_FAILED", "assigneeId: must be a UUID");
  const { data, error } = await supabaseServiceRole()
    .from("tenant_memberships")
    .select("user_id, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle<{ user_id: string; tenant_id: string }>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "ASSIGNEE_NOT_FOUND", "The assignee is not a member of this organization");
}

async function loadOwn(tenantId: string, investigationId: string): Promise<InvestigationRow> {
  if (!UUID.test(investigationId)) throw new ApiError(404, "INVESTIGATION_NOT_FOUND");
  const { data, error } = await supabaseServiceRole().from("investigations").select().eq("id", investigationId).eq("tenant_id", tenantId).maybeSingle<InvestigationRow>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "INVESTIGATION_NOT_FOUND");
  return data;
}

async function recordEvent(tenantId: string, investigationId: string, actorId: string | null, eventType: InvestigationEventType, detail: Record<string, unknown>) {
  const { error } = await supabaseServiceRole().from("investigation_events").insert({ tenant_id: tenantId, investigation_id: investigationId, actor_id: actorId, event_type: eventType, detail });
  if (error) throw new ApiError(500, "CREATE_FAILED", error.message);
}

async function audit(tenantId: string, actorId: string, action: string, investigationId: string, metadata: Record<string, unknown>) {
  await writeAudit({ tenantId, actorId, actorType: "user", action, objectType: "investigation", objectId: investigationId, outcome: "success", metadata });
}

export type CreateInvestigationInput = {
  title: string;
  summary?: string | null;
  priority?: InvestigationPriority;
  findingIds: string[];
  assigneeId?: string | null;
};

export function validateCreateInvestigation(raw: unknown): CreateInvestigationInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ApiError(400, "VALIDATION_FAILED", "body: must be a JSON object");
  const b = raw as Record<string, unknown>;
  const findingIds = Array.isArray(b.findingIds) ? [...new Set(b.findingIds.map(String))] : [];
  if (findingIds.length === 0 || findingIds.length > MAX_FINDINGS) throw new ApiError(400, "VALIDATION_FAILED", `findingIds: between 1 and ${MAX_FINDINGS} findings`);
  if (b.priority !== undefined && b.priority !== "" && !PRIORITIES.includes(b.priority as InvestigationPriority)) {
    throw new ApiError(400, "VALIDATION_FAILED", `priority: one of ${PRIORITIES.join(", ")}`);
  }
  return {
    title: text(b.title, 200, "title", true) as string,
    summary: text(b.summary, 4000, "summary"),
    priority: (b.priority || undefined) as InvestigationPriority | undefined,
    findingIds,
    assigneeId: (text(b.assigneeId, 36, "assigneeId") as string | null) ?? null,
  };
}

export async function createInvestigation(tenantId: string, actorId: string, input: CreateInvestigationInput): Promise<Investigation> {
  const findings = await loadTenantFindings(tenantId, input.findingIds);
  if (input.assigneeId) await assertMember(tenantId, input.assigneeId);
  const priority = input.priority ?? priorityFromSeverities(findings.map((f) => f.severity));
  const supabase = supabaseServiceRole();
  const year = new Date().getUTCFullYear();

  // The reference is unique per tenant. Take the next number and retry
  // on a concurrent create that took it first.
  let row: InvestigationRow | null = null;
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    const { data: refs, error: refError } = await supabase.from("investigations").select("reference").eq("tenant_id", tenantId).like("reference", `INV-${year}-%`);
    if (refError) throw new ApiError(500, "QUERY_FAILED", refError.message);
    const reference = formatReference(year, nextSequence(year, (refs ?? []).map((r: { reference: string }) => r.reference)));
    const { data, error } = await supabase
      .from("investigations")
      .insert({
        tenant_id: tenantId,
        reference,
        title: input.title,
        summary: input.summary ?? null,
        priority,
        assignee_id: input.assigneeId ?? null,
        created_by: actorId,
        status: "open",
      })
      .select()
      .single<InvestigationRow>();
    if (error?.code === "23505") continue;
    if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create investigation");
    row = data;
  }
  if (!row) throw new ApiError(409, "REFERENCE_CONFLICT", "Could not allocate an investigation reference; try again");

  const { error: linkError } = await supabase
    .from("investigation_findings")
    .insert(findings.map((f) => ({ tenant_id: tenantId, investigation_id: row!.id, finding_id: f.id, added_by: actorId })));
  if (linkError) throw new ApiError(500, "CREATE_FAILED", linkError.message);
  await recordEvent(tenantId, row.id, actorId, "created", { reference: row.reference, priority, findingIds: findings.map((f) => f.id), assigneeId: input.assigneeId ?? null });
  await audit(tenantId, actorId, "risk.investigation_created", row.id, { reference: row.reference, priority, findingCount: findings.length });
  return toInvestigation(row);
}

export async function changeInvestigationStatus(
  tenantId: string,
  actorId: string,
  investigationId: string,
  to: InvestigationStatus,
  reason: string | null,
): Promise<Investigation> {
  const current = await loadOwn(tenantId, investigationId);
  const { data: links, error } = await supabaseServiceRole()
    .from("investigation_findings")
    .select("finding_id, risk_findings(status)")
    .eq("tenant_id", tenantId)
    .eq("investigation_id", investigationId)
    .returns<Array<{ finding_id: string; risk_findings: { status: FindingStatus } | null }>>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const statuses = (links ?? []).map((l) => l.risk_findings?.status).filter((s): s is FindingStatus => Boolean(s));
  const cleanReason = text(reason, 4000, "reason");
  const blocker = transitionBlocker(current.status, to, statuses, cleanReason);
  if (blocker) throw new ApiError(409, blocker.code, blocker.message);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, updated_at: now };
  if (to === "resolved" || to === "closed") {
    patch.resolved_at = now;
    patch.resolution = cleanReason;
  } else if (current.status === "resolved" || current.status === "closed") {
    patch.resolved_at = null;
  }
  const { data, error: updateError } = await supabaseServiceRole()
    .from("investigations")
    .update(patch)
    .eq("id", investigationId)
    .eq("tenant_id", tenantId)
    .eq("status", current.status) // lost-update guard: someone else changed it first
    .select()
    .maybeSingle<InvestigationRow>();
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  if (!data) throw new ApiError(409, "STALE_STATUS", "The investigation changed while you were editing it; reload and try again");
  await recordEvent(tenantId, investigationId, actorId, "status_changed", { from: current.status, to, reason: cleanReason });
  await audit(tenantId, actorId, "risk.investigation_status_changed", investigationId, { from: current.status, to });
  return toInvestigation(data);
}

export async function assignInvestigation(tenantId: string, actorId: string, investigationId: string, assigneeId: string | null): Promise<Investigation> {
  const current = await loadOwn(tenantId, investigationId);
  if (assigneeId) await assertMember(tenantId, assigneeId);
  const { data, error } = await supabaseServiceRole()
    .from("investigations")
    .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
    .eq("id", investigationId)
    .eq("tenant_id", tenantId)
    .select()
    .single<InvestigationRow>();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to assign");
  await recordEvent(tenantId, investigationId, actorId, "assigned", { from: current.assignee_id, to: assigneeId });
  await audit(tenantId, actorId, "risk.investigation_assigned", investigationId, { assigneeId });
  return toInvestigation(data);
}

export async function addFindingToInvestigation(tenantId: string, actorId: string, investigationId: string, findingId: string): Promise<void> {
  await loadOwn(tenantId, investigationId);
  await loadTenantFindings(tenantId, [findingId]);
  const { error } = await supabaseServiceRole().from("investigation_findings").insert({ tenant_id: tenantId, investigation_id: investigationId, finding_id: findingId, added_by: actorId });
  if (error?.code === "23505") throw new ApiError(409, "ALREADY_LINKED", "That finding is already in this investigation");
  if (error) throw new ApiError(500, "CREATE_FAILED", error.message);
  await recordEvent(tenantId, investigationId, actorId, "finding_added", { findingId });
  await audit(tenantId, actorId, "risk.investigation_finding_added", investigationId, { findingId });
}

export async function removeFindingFromInvestigation(tenantId: string, actorId: string, investigationId: string, findingId: string): Promise<void> {
  await loadOwn(tenantId, investigationId);
  const { data: remaining, error: countError } = await supabaseServiceRole()
    .from("investigation_findings")
    .select("finding_id")
    .eq("tenant_id", tenantId)
    .eq("investigation_id", investigationId);
  if (countError) throw new ApiError(500, "QUERY_FAILED", countError.message);
  if ((remaining ?? []).length <= 1) throw new ApiError(409, "LAST_FINDING", "An investigation groups at least one finding; close it instead");
  const { data, error } = await supabaseServiceRole()
    .from("investigation_findings")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("investigation_id", investigationId)
    .eq("finding_id", findingId)
    .select("finding_id");
  if (error) throw new ApiError(500, "DELETE_FAILED", error.message);
  if ((data ?? []).length === 0) throw new ApiError(404, "FINDING_NOT_LINKED");
  await recordEvent(tenantId, investigationId, actorId, "finding_removed", { findingId });
  await audit(tenantId, actorId, "risk.investigation_finding_removed", investigationId, { findingId });
}

export async function addInvestigationNote(tenantId: string, actorId: string, investigationId: string, note: string): Promise<void> {
  await loadOwn(tenantId, investigationId);
  const clean = text(note, 4000, "note", true);
  await recordEvent(tenantId, investigationId, actorId, "note", { note: clean });
  await audit(tenantId, actorId, "risk.investigation_note_added", investigationId, {});
}

type SummaryRow = InvestigationRow & { investigation_findings: Array<{ risk_findings: { severity: RiskSeverity; status: FindingStatus } | null }> };

/** Newest first, with finding counts and the worst severity, as the calling user under RLS. */
export async function listInvestigations(tenantId: string, filter: { status?: InvestigationStatus; query?: string; limit?: number } = {}): Promise<InvestigationSummary[]> {
  const supabase = await supabaseServer();
  let q = supabase
    .from("investigations")
    .select("*, investigation_findings(risk_findings(severity, status))")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(filter.limit ?? 100, 200));
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.query !== undefined) {
    // Reduced to characters that cannot alter the filter syntax.
    const term = filter.query.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.:/@-]/g, "").slice(0, 100);
    if (!term) return [];
    q = q.or(`reference.ilike.*${term}*,title.ilike.*${term}*`);
  }
  const { data, error } = await q.returns<SummaryRow[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((row) => {
    const findings = (row.investigation_findings ?? []).map((l) => l.risk_findings).filter((f): f is { severity: RiskSeverity; status: FindingStatus } => Boolean(f));
    const { investigation_findings: _links, ...rest } = row;
    void _links;
    return {
      ...toInvestigation(rest),
      findingCount: findings.length,
      openFindingCount: findings.filter((f) => isFindingOpen(f.status)).length,
      worstSeverity: worstSeverity(findings.map((f) => f.severity)),
    };
  });
}

/** One investigation with its findings (with evidence) and timeline, as the calling user under RLS. */
export async function getInvestigation(tenantId: string, investigationId: string): Promise<InvestigationDetail | null> {
  if (!UUID.test(investigationId)) return null;
  const supabase = await supabaseServer();
  const [inv, links, events] = await Promise.all([
    supabase.from("investigations").select().eq("id", investigationId).eq("tenant_id", tenantId).maybeSingle<InvestigationRow>(),
    supabase
      .from("investigation_findings")
      .select("risk_findings(*, risk_evidence(*))")
      .eq("tenant_id", tenantId)
      .eq("investigation_id", investigationId)
      .returns<Array<{ risk_findings: Record<string, unknown> | null }>>(),
    supabase
      .from("investigation_events")
      .select("id, event_type, actor_id, detail, created_at")
      .eq("tenant_id", tenantId)
      .eq("investigation_id", investigationId)
      .order("created_at", { ascending: true })
      .limit(500),
  ]);
  if (inv.error) throw new ApiError(500, "QUERY_FAILED", inv.error.message);
  if (links.error) throw new ApiError(500, "QUERY_FAILED", links.error.message);
  if (events.error) throw new ApiError(500, "QUERY_FAILED", events.error.message);
  if (!inv.data) return null;
  return {
    ...toInvestigation(inv.data),
    findings: (links.data ?? [])
      .map((l) => l.risk_findings)
      .filter((f): f is Record<string, unknown> => Boolean(f))
      .map((f) => ({ ...toRiskFinding(f), evidence: ((f.risk_evidence as unknown[]) ?? []).map(toRiskEvidence) })),
    events: ((events.data ?? []) as Array<{ id: string; event_type: InvestigationEventType; actor_id: string | null; detail: Record<string, unknown>; created_at: string }>).map(
      (e): InvestigationEvent => ({ id: e.id, eventType: e.event_type, actorId: e.actor_id, detail: e.detail ?? {}, createdAt: e.created_at }),
    ),
  };
}
