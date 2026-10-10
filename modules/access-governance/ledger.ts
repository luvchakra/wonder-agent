import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import {
  ledgerEntry,
  ledgerEvents,
  type AdminGrantEvidence,
  type LedgerEntry,
  type LedgerEvidence,
  type LedgerRelationship,
  type LedgerSource,
  type LedgerStatus,
  type PackageEvidence,
  type RequestEvidence,
} from "./ledgerRules";

/**
 * ACCESS-P0-24 — the access ledger: for every account and every entitlement
 * of an account, where the access came from and what WonderID evidence
 * stands behind it (`ledgerRules.ts` decides; this file loads and writes).
 *
 * The ledger has no client write policy (migration 0114), so the refresh
 * writes with the service role. Every query below is filtered on the
 * caller's `tenantId`, and every row read is checked against it before it
 * is used (§14). History goes to `access_ledger_events`, which is
 * append-only.
 *
 * Refreshed after an import or a reconciliation, on the daily sweep, and
 * for one identity when its Access tab is opened, so the view is never
 * staler than its own records.
 */

const PAGE = 1000;
const MAX_ROWS = 100_000;
const CHUNK = 200;

type Row = Record<string, unknown>;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const own = (tenantId: string) => (r: Row) => r.tenant_id === tenantId;

/** Every row a query returns, a page at a time (PostgREST returns at most 1,000 per call). */
async function readPaged(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new ApiError(500, "QUERY_FAILED", `${what}: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function loadRelationships(tenantId: string, scope: { identityId?: string }): Promise<LedgerRelationship[]> {
  const admin = supabaseServiceRole();
  const accounts = (
    await readPaged((from, to) => {
      let q = admin
        .from("accounts")
        .select("id, tenant_id, application_id, identity_id, agent_id, source, source_integration_id, created_at, last_seen_at, last_used_at, missing_from_source_at")
        .eq("tenant_id", tenantId);
      if (scope.identityId) q = q.eq("identity_id", scope.identityId);
      return q.order("id").range(from, to);
    }, "accounts")
  ).filter(own(tenantId));

  const grants: Row[] = [];
  for (const ids of chunks(accounts.map((a) => a.id as string))) {
    const rows = await readPaged(
      (from, to) =>
        admin
          .from("access_grants")
          .select("id, tenant_id, account_id, entitlement_id, source_integration_id, granted_at, revoked_at")
          .eq("tenant_id", tenantId)
          .in("account_id", ids)
          .order("id")
          .range(from, to),
      "access_grants",
    );
    grants.push(...rows.filter(own(tenantId)));
  }

  const byId = new Map(accounts.map((a) => [a.id as string, a]));
  const rels: LedgerRelationship[] = accounts.map((a) => ({
    accountId: a.id as string,
    entitlementId: null,
    applicationId: a.application_id as string,
    identityId: (a.identity_id as string | null) ?? null,
    agentId: (a.agent_id as string | null) ?? null,
    accessGrantId: null,
    sourceIntegrationId: (a.source_integration_id as string | null) ?? null,
    reconciled: a.source === "reconciliation",
    firstSeenAt: a.created_at as string,
    revokedAt: null,
    lastSeenAt: (a.last_seen_at as string | null) ?? null,
    lastUsedAt: (a.last_used_at as string | null) ?? null,
    missingFromSourceAt: (a.missing_from_source_at as string | null) ?? null,
  }));
  // One relationship per account and entitlement: the latest grant row stands for it (a revoked one is kept only if none is live).
  const latest = new Map<string, Row>();
  for (const g of grants) {
    const key = `${g.account_id}|${g.entitlement_id}`;
    const prev = latest.get(key);
    const live = (r: Row) => r.revoked_at === null;
    if (!prev || (live(g) && !live(prev)) || (live(g) === live(prev) && (g.granted_at as string) > (prev.granted_at as string))) latest.set(key, g);
  }
  for (const g of latest.values()) {
    const a = byId.get(g.account_id as string);
    if (!a) continue;
    rels.push({
      accountId: a.id as string,
      entitlementId: g.entitlement_id as string,
      applicationId: a.application_id as string,
      identityId: (a.identity_id as string | null) ?? null,
      agentId: (a.agent_id as string | null) ?? null,
      accessGrantId: g.id as string,
      sourceIntegrationId: (g.source_integration_id as string | null) ?? (a.source_integration_id as string | null) ?? null,
      reconciled: a.source === "reconciliation",
      firstSeenAt: g.granted_at as string,
      revokedAt: (g.revoked_at as string | null) ?? null,
      lastSeenAt: (a.last_seen_at as string | null) ?? null,
      lastUsedAt: (a.last_used_at as string | null) ?? null,
      missingFromSourceAt: (a.missing_from_source_at as string | null) ?? null,
    });
  }
  return rels;
}

async function loadEvidence(tenantId: string, rels: LedgerRelationship[]): Promise<LedgerEvidence> {
  const admin = supabaseServiceRole();
  const identityIds = [...new Set(rels.map((r) => r.identityId).filter((x): x is string => x !== null))];
  const agentIds = [...new Set(rels.map((r) => r.agentId).filter((x): x is string => x !== null))];
  const grantIds = rels.map((r) => r.accessGrantId).filter((x): x is string => x !== null);

  const requestCols = "id, tenant_id, subject_identity_id, agent_id, application_id, entitlement_id, decided_by, decided_at, justification, requested_expiry";
  const requestRows: Row[] = [];
  for (const [column, ids] of [["subject_identity_id", identityIds], ["agent_id", agentIds]] as const) {
    for (const part of chunks(ids)) {
      const rows = await readPaged(
        (from, to) =>
          admin
            .from("access_requests")
            .select(requestCols)
            .eq("tenant_id", tenantId)
            .eq("request_type", "grant")
            .in("status", ["approved", "fulfilled"])
            .not("application_id", "is", null)
            .in(column, part)
            .order("id")
            .range(from, to),
        "access_requests",
      );
      requestRows.push(...rows.filter(own(tenantId)));
    }
  }
  const requests: RequestEvidence[] = [...new Map(requestRows.map((r) => [r.id as string, r])).values()].map((r) => ({
    id: r.id as string,
    subjectIdentityId: (r.subject_identity_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    applicationId: r.application_id as string,
    entitlementId: (r.entitlement_id as string | null) ?? null,
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    justification: (r.justification as string | null) ?? null,
    requestedExpiry: (r.requested_expiry as string | null) ?? null,
  }));

  // A package's item counts once it was fulfilled; a later revocation keeps it as evidence of how the access came.
  const packages: PackageEvidence[] = [];
  for (const part of chunks(identityIds)) {
    const rows = await readPaged(
      (from, to) =>
        admin
          .from("access_package_assignment_items")
          .select(
            "tenant_id, application_id, entitlement_id, status, access_package_assignments!inner(id, tenant_id, identity_id, status, request_id, assigned_by, starts_at, expires_at, justification)",
          )
          .eq("tenant_id", tenantId)
          .in("status", ["fulfilled", "revoke_pending", "revoked"])
          .in("access_package_assignments.identity_id", part)
          .order("id")
          .range(from, to),
      "access_package_assignment_items",
    );
    for (const r of rows.filter(own(tenantId))) {
      const a = r.access_package_assignments as Row | null;
      if (!a || a.tenant_id !== tenantId) continue;
      packages.push({
        assignmentId: a.id as string,
        identityId: a.identity_id as string,
        applicationId: r.application_id as string,
        entitlementId: (r.entitlement_id as string | null) ?? null,
        assignmentStatus: a.status as PackageEvidence["assignmentStatus"],
        requestId: (a.request_id as string | null) ?? null,
        assignedBy: (a.assigned_by as string | null) ?? null,
        startsAt: a.starts_at as string,
        expiresAt: (a.expires_at as string | null) ?? null,
        justification: (a.justification as string | null) ?? null,
      });
    }
  }

  // An administrator's grant: createManualAccessGrant's audit event names the grant and who made it.
  const adminGrants = new Map<string, AdminGrantEvidence>();
  for (const part of chunks(grantIds)) {
    const { data, error } = await admin
      .from("audit_logs")
      .select("tenant_id, actor_id, object_id, created_at")
      .eq("tenant_id", tenantId)
      .eq("action", "access.grant_created")
      .eq("outcome", "success")
      .in("object_id", part)
      .limit(part.length * 2);
    if (error) throw new ApiError(500, "QUERY_FAILED", `audit_logs: ${error.message}`);
    for (const r of ((data ?? []) as Row[]).filter(own(tenantId))) {
      adminGrants.set(r.object_id as string, { grantId: r.object_id as string, actorId: (r.actor_id as string | null) ?? null, at: r.created_at as string });
    }
  }
  return { requests, packages, adminGrants };
}

type StoredRow = { id: string; tenant_id: string; account_id: string; entitlement_id: string | null; status: LedgerStatus; source: LedgerSource; missing_from_source_at: string | null };

function toColumns(tenantId: string, e: LedgerEntry, now: string) {
  return {
    tenant_id: tenantId,
    account_id: e.accountId,
    entitlement_id: e.entitlementId,
    application_id: e.applicationId,
    identity_id: e.identityId,
    access_grant_id: e.accessGrantId,
    source: e.source,
    status: e.status,
    request_id: e.requestId,
    access_package_assignment_id: e.accessPackageAssignmentId,
    source_integration_id: e.sourceIntegrationId,
    approved_by: e.approvedBy,
    approved_at: e.approvedAt,
    business_justification: e.businessJustification,
    start_at: e.startAt,
    expiry_at: e.expiryAt,
    first_seen_at: e.firstSeenAt,
    last_verified_at: e.lastVerifiedAt,
    last_used_at: e.lastUsedAt,
    missing_from_source_at: e.missingFromSourceAt,
    evidence: e.evidence,
    updated_at: now,
  };
}

/** Equal as stored: timestamps compared as instants, objects whatever their key order (jsonb reorders keys). */
function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (v === undefined || v === null) return null;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const t = Date.parse(v);
      return Number.isNaN(t) ? v : t;
    }
    if (typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v as Row).sort().map((k) => [k, norm((v as Row)[k])]));
    }
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * Recomputes the ledger for a tenant, or for one identity's accounts.
 * Returns how many relationships were first recorded and how many changed.
 */
export async function refreshAccessLedger(tenantId: string, scope: { identityId?: string } = {}): Promise<{ recorded: number; changed: number }> {
  if (!tenantId) throw new ApiError(400, "VALIDATION_FAILED", "tenant required");
  const rels = await loadRelationships(tenantId, scope);
  if (rels.length === 0) return { recorded: 0, changed: 0 };
  const evidence = await loadEvidence(tenantId, rels);
  const now = new Date();
  const nowIso = now.toISOString();
  const entries = rels.map((r) => ledgerEntry(r, evidence, now));

  const admin = supabaseServiceRole();
  const stored = new Map<string, Row>();
  for (const ids of chunks([...new Set(entries.map((e) => e.accountId))])) {
    const rows = await readPaged(
      (from, to) => admin.from("access_ledger").select("*").eq("tenant_id", tenantId).in("account_id", ids).order("id").range(from, to),
      "access_ledger",
    );
    for (const r of rows.filter(own(tenantId))) stored.set(`${r.account_id}|${r.entitlement_id ?? ""}`, r);
  }

  const inserts: ReturnType<typeof toColumns>[] = [];
  const updates: { id: string; cols: ReturnType<typeof toColumns> }[] = [];
  const events: { key: string; entry: LedgerEntry; before: StoredRow | null }[] = [];
  for (const e of entries) {
    const key = `${e.accountId}|${e.entitlementId ?? ""}`;
    const before = (stored.get(key) as StoredRow | undefined) ?? null;
    const cols = toColumns(tenantId, e, nowIso);
    if (!before) {
      inserts.push(cols);
      events.push({ key, entry: e, before: null });
      continue;
    }
    const changed = (Object.keys(cols) as (keyof typeof cols)[]).some((k) => k !== "updated_at" && k !== "tenant_id" && !same(cols[k], (before as unknown as Row)[k]));
    if (!changed) continue;
    updates.push({ id: before.id, cols });
    events.push({ key, entry: e, before });
  }

  const ids = new Map<string, string>();
  for (const part of chunks(inserts, 500)) {
    // A concurrent refresh may record the same relationship first; that row stands and this one records nothing.
    const { data, error } = await admin
      .from("access_ledger")
      .upsert(part, { onConflict: "tenant_id,account_id,entitlement_id", ignoreDuplicates: true })
      .select("id, account_id, entitlement_id");
    if (error) throw new ApiError(500, "WRITE_FAILED", `access_ledger: ${error.message}`);
    for (const r of (data ?? []) as Row[]) ids.set(`${r.account_id}|${r.entitlement_id ?? ""}`, r.id as string);
  }
  for (const u of updates) {
    const { error } = await admin.from("access_ledger").update(u.cols).eq("tenant_id", tenantId).eq("id", u.id);
    if (error) throw new ApiError(500, "WRITE_FAILED", `access_ledger: ${error.message}`);
    ids.set(`${u.cols.account_id}|${u.cols.entitlement_id ?? ""}`, u.id);
  }

  const eventRows = events.flatMap(({ key, entry, before }) =>
    ledgerEvents(before ? { status: before.status, source: before.source, missingFromSourceAt: before.missing_from_source_at } : null, entry).map((ev) => ({
      tenant_id: tenantId,
      ledger_id: ids.get(key)!,
      account_id: entry.accountId,
      entitlement_id: entry.entitlementId,
      identity_id: entry.identityId,
      event_type: ev.eventType,
      from_status: ev.fromStatus,
      to_status: entry.status,
      from_source: ev.fromSource,
      to_source: entry.source,
      details: { evidence: entry.evidence },
      occurred_at: nowIso,
    })),
  );
  for (const part of chunks(eventRows.filter((r) => r.ledger_id), 500)) {
    const { error } = await admin.from("access_ledger_events").insert(part);
    if (error) throw new ApiError(500, "WRITE_FAILED", `access_ledger_events: ${error.message}`);
  }
  return { recorded: events.filter((e) => !e.before && ids.has(e.key)).length, changed: updates.length };
}

/** The daily sweep: every active organization's ledger. One organization's failure is reported, not allowed to stop the rest. */
export async function refreshAccessLedgerForAllTenants(): Promise<{ tenants: number; recorded: number; changed: number; failed: number }> {
  const admin = supabaseServiceRole();
  const { data, error } = await admin.from("tenants").select("id").eq("status", "active");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const out = { tenants: 0, recorded: 0, changed: 0, failed: 0 };
  for (const t of (data ?? []) as { id: string }[]) {
    try {
      const r = await refreshAccessLedger(t.id);
      out.tenants += 1;
      out.recorded += r.recorded;
      out.changed += r.changed;
    } catch {
      out.failed += 1;
    }
  }
  return out;
}

export type IdentityAccessEntry = {
  id: string;
  applicationId: string;
  applicationName: string | null;
  accountName: string | null;
  entitlementId: string | null;
  entitlementName: string | null;
  source: LedgerSource;
  status: LedgerStatus;
  requestId: string | null;
  accessPackageAssignmentId: string | null;
  approvedAt: string | null;
  businessJustification: string | null;
  expiryAt: string | null;
  firstSeenAt: string;
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  missingFromSourceAt: string | null;
};

/**
 * "Why does this identity have this access?": the identity's ledger, read
 * as the signed-in user under RLS (and filtered on the tenant as well).
 * Refreshes that identity's entries first.
 */
export async function getIdentityAccessLedger(tenantId: string, identityId: string): Promise<{ entries: IdentityAccessEntry[]; refreshed: boolean }> {
  // A failed refresh still shows what is stored, and says it may be out of date (§17.5).
  const refreshed = await refreshAccessLedger(tenantId, { identityId }).then(
    () => true,
    () => false,
  );
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("access_ledger")
    .select(
      "id, application_id, entitlement_id, source, status, request_id, access_package_assignment_id, approved_at, business_justification, expiry_at, first_seen_at, last_verified_at, last_used_at, missing_from_source_at, applications(name), entitlements(name), accounts(account_name, external_account_ref)",
    )
    .eq("tenant_id", tenantId)
    .eq("identity_id", identityId)
    .order("first_seen_at", { ascending: false })
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const entries = ((data ?? []) as Row[]).map((r) => {
    const app = r.applications as { name: string } | null;
    const ent = r.entitlements as { name: string } | null;
    const acc = r.accounts as { account_name: string | null; external_account_ref: string } | null;
    return {
      id: r.id as string,
      applicationId: r.application_id as string,
      applicationName: app?.name ?? null,
      accountName: acc?.account_name ?? acc?.external_account_ref ?? null,
      entitlementId: (r.entitlement_id as string | null) ?? null,
      entitlementName: ent?.name ?? null,
      source: r.source as LedgerSource,
      status: r.status as LedgerStatus,
      requestId: (r.request_id as string | null) ?? null,
      accessPackageAssignmentId: (r.access_package_assignment_id as string | null) ?? null,
      approvedAt: (r.approved_at as string | null) ?? null,
      businessJustification: (r.business_justification as string | null) ?? null,
      expiryAt: (r.expiry_at as string | null) ?? null,
      firstSeenAt: r.first_seen_at as string,
      lastVerifiedAt: (r.last_verified_at as string | null) ?? null,
      lastUsedAt: (r.last_used_at as string | null) ?? null,
      missingFromSourceAt: (r.missing_from_source_at as string | null) ?? null,
    };
  });
  return { entries, refreshed };
}
