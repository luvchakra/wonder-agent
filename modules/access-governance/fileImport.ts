import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { IdentityType } from "@/lib/shared/types/agent-identity";
import type { ImportApplyRow, ImportPlanRow, ImportRecord } from "@/lib/shared/types/integrations";
import { listIdentitiesForCorrelation } from "@/modules/agent-identity/service";
import { registerApplication, updateApplication } from "./catalog";
import { createManualAccessGrant } from "./grants";
import { planAccessImport, type AccessImportKind, type AccessLookups, type AccessPlanRow } from "./fileImportRules";

/**
 * Applications, entitlements, accounts and access imported from a CSV on
 * their object pages (2026-10-10, user decision). The Integration module
 * has already received the file through the File imports connection and
 * hands over what that connection stored (non-negotiable #20); this module
 * decides what each record is and writes it, so its tables keep a single
 * owner (#5, #6).
 *
 * Additive only: records are added or updated; nothing absent from the
 * file is removed, revoked or deactivated. The caller has checked
 * integration.execute and access.manage; reads and writes run as that
 * user under RLS, each filtered on `tenantId` as well (§14). Access goes
 * through createManualAccessGrant, so it meets the same rules (an AI
 * agent's account, separation of duties) as access granted by hand.
 */

const PAGE = 1000;
const MAX_ROWS = 50_000;
const NON_AGENT_TYPES: IdentityType[] = ["HUMAN", "EXTERNAL", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API", "MACHINE"];

/** Every row of one of this module's tables in the tenant, a page at a time (PostgREST returns at most 1,000 per call). */
async function readAll<T>(table: string, columns: string, tenantId: string, opts: { activeGrantsOnly?: boolean } = {}): Promise<T[]> {
  const supabase = await supabaseServer();
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = supabase.from(table).select(columns).eq("tenant_id", tenantId);
    if (opts.activeGrantsOnly) q = q.is("revoked_at", null);
    const { data, error } = await q.order("id").range(from, from + PAGE - 1);
    if (error) throw new ApiError(500, "QUERY_FAILED", `${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

type Row = Record<string, unknown>;

async function loadLookups(tenantId: string, kind: AccessImportKind): Promise<AccessLookups> {
  const needEntitlements = kind === "entitlement" || kind === "access_grant";
  const needAccounts = kind === "account" || kind === "access_grant";
  const [applications, entitlements, accounts, grants, owners] = await Promise.all([
    kind === "access_grant" ? Promise.resolve([] as Row[]) : readAll<Row>("applications", "id, name, category, description", tenantId),
    needEntitlements ? readAll<Row>("entitlements", "id, application_id, name, privilege_level, data_classification", tenantId) : Promise.resolve([] as Row[]),
    needAccounts
      ? readAll<Row>("accounts", "id, application_id, external_account_ref, account_name, status, account_type, last_used_at, identity_id, agent_id", tenantId)
      : Promise.resolve([] as Row[]),
    kind === "access_grant" ? readAll<Row>("access_grants", "id, account_id, entitlement_id, grant_type", tenantId, { activeGrantsOnly: true }) : Promise.resolve([] as Row[]),
    kind === "account" ? listIdentitiesForCorrelation(tenantId, NON_AGENT_TYPES) : Promise.resolve([]),
  ]);
  return {
    applications: applications.map((a) => ({ id: a.id as string, name: a.name as string, category: (a.category as string | null) ?? null, description: (a.description as string | null) ?? null })),
    entitlements: entitlements.map((e) => ({
      id: e.id as string,
      applicationId: e.application_id as string,
      name: e.name as string,
      privilegeLevel: e.privilege_level as string,
      dataClassification: (e.data_classification as string | null) ?? null,
    })),
    accounts: accounts.map((a) => ({
      id: a.id as string,
      applicationId: a.application_id as string,
      externalAccountRef: a.external_account_ref as string,
      accountName: (a.account_name as string | null) ?? null,
      status: a.status as string,
      accountType: a.account_type as string,
      lastUsedAt: (a.last_used_at as string | null) ?? null,
      identityId: (a.identity_id as string | null) ?? null,
      agentId: (a.agent_id as string | null) ?? null,
    })),
    grants: grants.map((g) => ({ accountId: g.account_id as string, entitlementId: g.entitlement_id as string, grantType: g.grant_type as string })),
    owners: owners.map((o) => ({ id: o.id, email: o.email, username: o.username, sourceNativeId: o.sourceNativeId })),
  };
}

const strip = (p: AccessPlanRow): ImportPlanRow => ({ row: p.row, externalId: p.externalId, decision: p.decision, targetId: p.targetId, changes: p.changes, note: p.note });

/** What importing these records would do, without writing anything. */
export async function previewAccessImport(tenantId: string, kind: AccessImportKind, records: ImportRecord[], origin: { integrationId: string | null }): Promise<ImportPlanRow[]> {
  const lookups = await loadLookups(tenantId, kind);
  return planAccessImport(kind, records, lookups, { integrationId: origin.integrationId ?? "" }).map(strip);
}

const message = (err: unknown) => (err instanceof Error ? err.message : "failed").slice(0, 300);

/**
 * Inserts rows in batches; a batch the database refuses is retried one row
 * at a time, so each failure is reported against its own record.
 */
async function insertRows(table: string, tenantId: string, plans: AccessPlanRow[], results: Map<AccessPlanRow, ImportApplyRow>) {
  const supabase = await supabaseServer();
  for (let i = 0; i < plans.length; i += 500) {
    const batch = plans.slice(i, i + 500);
    const { data, error } = await supabase
      .from(table)
      .insert(batch.map((p) => ({ ...p.insert, tenant_id: tenantId })))
      .select("id");
    if (!error && data && data.length === batch.length) {
      batch.forEach((p, j) => results.set(p, { row: p.row, externalId: p.externalId, outcome: "created", targetId: data[j].id as string, message: null }));
      continue;
    }
    for (const p of batch) {
      const one = await supabase
        .from(table)
        .insert({ ...p.insert, tenant_id: tenantId })
        .select("id")
        .single();
      results.set(
        p,
        one.error || !one.data
          ? { row: p.row, externalId: p.externalId, outcome: "failed", targetId: null, message: one.error?.code === "23505" ? "a record with this id already exists" : (one.error?.message ?? "insert failed").slice(0, 300) }
          : { row: p.row, externalId: p.externalId, outcome: "created", targetId: one.data.id as string, message: null },
      );
    }
  }
}

async function updateRows(table: string, tenantId: string, plans: AccessPlanRow[], results: Map<AccessPlanRow, ImportApplyRow>, stamp: boolean) {
  const supabase = await supabaseServer();
  const now = new Date().toISOString();
  for (const p of plans) {
    const { data, error } = await supabase
      .from(table)
      .update({ ...p.update, ...(stamp ? { updated_at: now } : {}) })
      .eq("tenant_id", tenantId)
      .eq("id", p.targetId!)
      .select("id")
      .maybeSingle();
    results.set(
      p,
      error || !data
        ? { row: p.row, externalId: p.externalId, outcome: "failed", targetId: p.targetId, message: (error?.message ?? "not found in this organization").slice(0, 300) }
        : { row: p.row, externalId: p.externalId, outcome: "updated", targetId: p.targetId, message: null },
    );
  }
}

/**
 * Applies the records: re-plans them against the current data (the
 * preview may be stale), then adds and updates. Returns one result per
 * record; a failure is reported, never thrown, so one bad row cannot leave
 * the rest unreported (§17.5).
 */
export async function applyAccessImport(
  tenantId: string,
  actorId: string,
  kind: AccessImportKind,
  records: ImportRecord[],
  origin: { integrationId: string; jobId: string },
): Promise<ImportApplyRow[]> {
  const lookups = await loadLookups(tenantId, kind);
  const plans = planAccessImport(kind, records, lookups, origin);
  const results = new Map<AccessPlanRow, ImportApplyRow>();
  for (const p of plans) {
    if (p.decision === "unchanged") results.set(p, { row: p.row, externalId: p.externalId, outcome: "unchanged", targetId: p.targetId, message: p.note });
    if (p.decision === "invalid" || p.decision === "review") results.set(p, { row: p.row, externalId: p.externalId, outcome: "skipped", targetId: null, message: p.note });
  }
  const creates = plans.filter((p) => p.decision === "new");
  const updates = plans.filter((p) => p.decision === "update");

  if (kind === "application") {
    // Through the catalog's own services: each is validated and audited as if entered by hand.
    for (const p of creates) {
      try {
        const app = await registerApplication(tenantId, actorId, p.insert as { name: string }, { discoverySource: "integration", sourceIntegrationId: origin.integrationId });
        results.set(p, { row: p.row, externalId: p.externalId, outcome: "created", targetId: app.id, message: null });
      } catch (err) {
        results.set(p, { row: p.row, externalId: p.externalId, outcome: "failed", targetId: null, message: message(err) });
      }
    }
    for (const p of updates) {
      try {
        await updateApplication(tenantId, actorId, p.targetId!, p.update as Record<string, unknown>);
        results.set(p, { row: p.row, externalId: p.externalId, outcome: "updated", targetId: p.targetId, message: null });
      } catch (err) {
        results.set(p, { row: p.row, externalId: p.externalId, outcome: "failed", targetId: p.targetId, message: message(err) });
      }
    }
  } else if (kind === "access_grant") {
    for (const p of creates) {
      try {
        const grant = await createManualAccessGrant(tenantId, actorId, p.insert!.account_id as string, p.insert!.entitlement_id as string, p.insert!.grant_type as never);
        results.set(p, { row: p.row, externalId: p.externalId, outcome: "created", targetId: grant.id, message: null });
      } catch (err) {
        results.set(p, { row: p.row, externalId: p.externalId, outcome: "failed", targetId: null, message: message(err) });
      }
    }
  } else {
    const table = kind === "entitlement" ? "entitlements" : "accounts";
    await insertRows(table, tenantId, creates, results);
    await updateRows(table, tenantId, updates, results, kind === "account");
    // One audit event per import for these inventories, with the records it touched (ids, never values).
    const touched = [...results.values()].filter((r) => r.outcome === "created" || r.outcome === "updated");
    if (touched.length) {
      await writeAudit({
        tenantId,
        actorId,
        actorType: "user",
        action: kind === "entitlement" ? "entitlement.imported" : "account.imported",
        objectType: "integration",
        objectId: origin.integrationId,
        outcome: [...results.values()].some((r) => r.outcome === "failed") ? "failure" : "success",
        correlationId: origin.jobId,
        metadata: {
          jobId: origin.jobId,
          created: touched.filter((r) => r.outcome === "created").map((r) => r.targetId).slice(0, 500),
          updated: touched.filter((r) => r.outcome === "updated").map((r) => r.targetId).slice(0, 500),
          total: touched.length,
        },
      });
    }
  }
  return plans.map((p) => results.get(p) ?? { row: p.row, externalId: p.externalId, outcome: "failed", targetId: null, message: "not applied" });
}
