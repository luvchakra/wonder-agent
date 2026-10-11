import "server-only";

import { createHash } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { getNormalizedObjectsAsSystem } from "@/modules/integrations/service";
import { accountRefOf } from "./accountRules";
import { refreshAccessLedger } from "./ledger";
import {
  belongsToApplication,
  countsOf,
  planEntitlements,
  planFingerprint,
  planGrants,
  type AccessCounts,
  type EntitlementPlan,
  type ExistingEntitlement,
  type ExistingGrant,
  type GrantPlan,
  type ReconcileMode,
} from "./connectorAccessRules";

/**
 * ACCESS-P0-27 — an onboarded application's entitlements and access, kept
 * in step with what its connector imported (connectorAccessRules.ts
 * decides). A preview records what a run would do and changes nothing; an
 * apply writes exactly that, and when it carries a preview's id it refuses
 * if the plan has changed since. Nothing is deleted or revoked: what the
 * source no longer lists is marked missing from it, and the access ledger
 * records the removal and any return.
 *
 * Every read and write uses the service role (access_grants and the run
 * table have no client write policy) and names `tenantId` explicitly; rows
 * read are checked against it before use (§14). The user path's caller has
 * checked `access.manage`; the system path is Integration's post-sync
 * chain, which passes the connection's own tenant.
 */

const PAGE = 1000;
const MAX_ROWS = 100_000;
const CHUNK = 200;
const SAMPLES = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof supabaseServiceRole>;

export type AccessReconciliationRun = {
  id: string;
  applicationId: string;
  integrationId: string | null;
  mode: ReconcileMode;
  dryRun: boolean;
  status: "succeeded" | "failed";
  counts: AccessCounts | Record<string, never>;
  samples: AccessSamples | Record<string, never>;
  error: string | null;
  previewRunId: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type AccessSamples = {
  entitlements: { added: string[]; changed: string[]; removed: string[]; restored: string[]; invalid: string[] };
  grants: { added: string[]; removed: string[]; restored: string[]; unresolved: string[] };
};

function toRun(r: Row): AccessReconciliationRun {
  return {
    id: r.id as string,
    applicationId: r.application_id as string,
    integrationId: (r.integration_id as string | null) ?? null,
    mode: r.mode as ReconcileMode,
    dryRun: Boolean(r.dry_run),
    status: r.status as AccessReconciliationRun["status"],
    counts: (r.counts as AccessReconciliationRun["counts"]) ?? {},
    samples: (r.samples as AccessReconciliationRun["samples"]) ?? {},
    error: (r.error as string | null) ?? null,
    previewRunId: (r.preview_run_id as string | null) ?? null,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
  };
}

const own = (tenantId: string) => (r: Row) => r.tenant_id === tenantId;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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

type LiveConfig = { integrationId: string | null; accountIdentifierField: string | null; entitlementSource: "connector" | "manual" | null };

/** The latest runs for an application (members read them under RLS-equivalent tenant filtering). */
export async function listAccessReconciliationRuns(tenantId: string, applicationId: string, limit = 5): Promise<AccessReconciliationRun[]> {
  if (!UUID_RE.test(applicationId)) return [];
  const { data, error } = await supabaseServiceRole()
    .from("access_reconciliation_runs")
    .select()
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .order("started_at", { ascending: false })
    .limit(Math.min(limit, 50));
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).filter(own(tenantId)).map(toRun);
}

/** A person's preview or apply (the caller has checked access.manage). */
export async function reconcileApplicationAccess(
  tenantId: string,
  actorId: string,
  applicationId: string,
  opts: { dryRun: boolean; mode?: ReconcileMode; previewRunId?: string | null },
): Promise<AccessReconciliationRun> {
  return reconcileAccess(tenantId, actorId, applicationId, { dryRun: opts.dryRun, mode: opts.mode ?? "full", previewRunId: opts.previewRunId ?? null, syncJobId: null });
}

/** INTEGRATION-P0-19's post-sync step: an apply as the system, for the connection's own tenant. */
export async function reconcileApplicationAccessAsSystem(tenantId: string, applicationId: string, opts: { mode: ReconcileMode; syncJobId: string }): Promise<AccessReconciliationRun> {
  return reconcileAccess(tenantId, null, applicationId, { dryRun: false, mode: opts.mode, previewRunId: null, syncJobId: opts.syncJobId });
}

async function reconcileAccess(
  tenantId: string,
  actorId: string | null,
  applicationId: string,
  opts: { dryRun: boolean; mode: ReconcileMode; previewRunId: string | null; syncJobId: string | null },
): Promise<AccessReconciliationRun> {
  if (!UUID_RE.test(applicationId)) throw new ApiError(404, "NOT_FOUND", "No such application");
  if (opts.mode !== "full" && opts.mode !== "incremental") throw new ApiError(400, "VALIDATION_FAILED", "mode: full or incremental");
  const admin = supabaseServiceRole();
  const [{ data: app }, { data: onboarding, error: onbError }] = await Promise.all([
    admin.from("applications").select("id, tenant_id, name").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle(),
    admin.from("application_onboardings").select("tenant_id, promoted_config").eq("tenant_id", tenantId).eq("application_id", applicationId).maybeSingle(),
  ]);
  if (onbError) throw new ApiError(500, "QUERY_FAILED", onbError.message);
  if (!app || app.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such application");
  const config = (onboarding && onboarding.tenant_id === tenantId ? onboarding.promoted_config : null) as LiveConfig | null;
  if (!config) throw new ApiError(409, "NOT_ONBOARDED", "Promote an onboarding configuration before reconciling access");
  if (!config.integrationId) throw new ApiError(409, "NOT_CONNECTED", "The live configuration has no connector to reconcile against");
  if (config.entitlementSource !== "connector") throw new ApiError(409, "NOT_CONNECTOR_ENTITLEMENTS", "The live configuration takes entitlements from elsewhere, not the connector");
  if (!config.accountIdentifierField) throw new ApiError(409, "NOT_CONFIGURED", "The live configuration names no account identifier");
  const integrationId = config.integrationId;
  const startedAt = new Date().toISOString();

  const record = async (fields: Row) => {
    const { data, error } = await admin
      .from("access_reconciliation_runs")
      .insert({
        tenant_id: tenantId,
        application_id: applicationId,
        integration_id: integrationId,
        mode: opts.mode,
        dry_run: opts.dryRun,
        preview_run_id: opts.previewRunId,
        triggered_by: actorId,
        sync_job_id: opts.syncJobId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        ...fields,
      })
      .select()
      .single();
    if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Could not record the run");
    return toRun(data);
  };

  try {
    const loaded = await load(admin, tenantId, applicationId, integrationId, app.name as string, config.accountIdentifierField);
    const entPlan = planEntitlements({ integrationId, mode: opts.mode, staged: loaded.stagedEntitlements, existing: loaded.entitlements });
    const grantPlan = planGrants({
      integrationId,
      mode: opts.mode,
      staged: loaded.stagedGrants,
      accountByRef: loaded.accountByRef,
      entitlementByRef: entPlan.byRef,
      existing: loaded.grants,
    });
    const counts = countsOf(entPlan, grantPlan);
    const samples = samplesOf(entPlan, grantPlan, loaded.accountNames, loaded.entitlementNames);
    const planHash = createHash("sha256").update(planFingerprint(entPlan, grantPlan)).digest("hex");

    if (opts.dryRun) return await record({ status: "succeeded", counts, samples, plan_hash: planHash });

    if (opts.previewRunId) {
      const { data: preview } = await admin
        .from("access_reconciliation_runs")
        .select("tenant_id, application_id, dry_run, status, plan_hash, mode")
        .eq("tenant_id", tenantId)
        .eq("id", opts.previewRunId)
        .maybeSingle();
      if (!preview || preview.tenant_id !== tenantId || preview.application_id !== applicationId || !preview.dry_run || preview.status !== "succeeded" || preview.mode !== opts.mode) {
        throw new ApiError(404, "PREVIEW_NOT_FOUND", "That preview is not this application's");
      }
      if (preview.plan_hash !== planHash) throw new ApiError(409, "PLAN_CHANGED", "The source or the records changed since the preview; preview again");
    }

    await applyEntitlements(admin, tenantId, applicationId, integrationId, entPlan);
    await applyGrants(admin, tenantId, integrationId, grantPlan, entPlan.byRef);

    const run = await record({ status: "succeeded", counts, samples, plan_hash: planHash });
    await writeAudit({
      tenantId,
      actorId,
      actorType: actorId ? "user" : "system",
      action: "access.reconciled",
      objectType: "application",
      objectId: applicationId,
      outcome: "success",
      correlationId: opts.syncJobId ?? run.id,
      metadata: { runId: run.id, integrationId, mode: opts.mode, previewRunId: opts.previewRunId, syncJobId: opts.syncJobId, counts },
    });
    // Removals and returns become ledger events; the daily sweep catches up if this fails.
    await refreshAccessLedger(tenantId).catch(() => undefined);
    return run;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Access reconciliation failed";
    // A refused apply (stale preview, wrong preview) writes nothing and is not a failed run.
    if (err instanceof ApiError && (err.code === "PLAN_CHANGED" || err.code === "PREVIEW_NOT_FOUND")) throw err;
    const run = await record({ status: "failed", error: message.slice(0, 1000) }).catch(() => null);
    if (!opts.dryRun) {
      await writeAudit({
        tenantId,
        actorId,
        actorType: actorId ? "user" : "system",
        action: "access.reconciled",
        objectType: "application",
        objectId: applicationId,
        outcome: "failure",
        correlationId: opts.syncJobId ?? run?.id,
        metadata: { runId: run?.id ?? null, integrationId, error: message.slice(0, 300) },
      });
    }
    throw err;
  }
}

async function load(admin: Admin, tenantId: string, applicationId: string, integrationId: string, appName: string, identifierField: string) {
  const [stagedEnts, stagedGrants, stagedAccounts, entRows, accountRows] = await Promise.all([
    getNormalizedObjectsAsSystem(tenantId, integrationId, "entitlement"),
    getNormalizedObjectsAsSystem(tenantId, integrationId, "access_grant"),
    getNormalizedObjectsAsSystem(tenantId, integrationId, "account"),
    readPaged(
      (from, to) =>
        admin
          .from("entitlements")
          .select("id, tenant_id, name, privilege_level, data_classification, source_integration_id, external_ref, missing_from_source_at")
          .eq("tenant_id", tenantId)
          .eq("application_id", applicationId)
          .order("id")
          .range(from, to),
      "entitlements",
    ),
    readPaged(
      (from, to) => admin.from("accounts").select("id, tenant_id, external_account_ref, account_name").eq("tenant_id", tenantId).eq("application_id", applicationId).order("id").range(from, to),
      "accounts",
    ),
  ]);
  const entitlements: ExistingEntitlement[] = entRows.filter(own(tenantId)).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    privilegeLevel: e.privilege_level as string,
    dataClassification: (e.data_classification as string | null) ?? null,
    sourceIntegrationId: (e.source_integration_id as string | null) ?? null,
    externalRef: (e.external_ref as string | null) ?? null,
    missingFromSourceAt: (e.missing_from_source_at as string | null) ?? null,
  }));
  const accounts = accountRows.filter(own(tenantId));

  const grants: ExistingGrant[] = [];
  for (const ids of chunks(accounts.map((a) => a.id as string))) {
    const rows = await readPaged(
      (from, to) =>
        admin
          .from("access_grants")
          .select("id, tenant_id, account_id, entitlement_id, grant_type, source_integration_id, missing_from_source_at")
          .eq("tenant_id", tenantId)
          .in("account_id", ids)
          .is("revoked_at", null)
          .order("id")
          .range(from, to),
      "access_grants",
    );
    for (const g of rows.filter(own(tenantId))) {
      grants.push({
        id: g.id as string,
        accountId: g.account_id as string,
        entitlementId: g.entitlement_id as string,
        grantType: g.grant_type as string,
        sourceIntegrationId: (g.source_integration_id as string | null) ?? null,
        missingFromSourceAt: (g.missing_from_source_at as string | null) ?? null,
      });
    }
  }

  // The connector's account id → this application's account, by the same key account reconciliation uses.
  const accountIdByKey = new Map(accounts.map((a) => [a.external_account_ref as string, a.id as string]));
  const accountByRef = new Map<string, string>();
  for (const o of stagedAccounts) {
    const key = accountRefOf({ externalId: o.externalId, ...o.raw, normalized: o.normalized }, identifierField);
    const id = key ? accountIdByKey.get(key) : undefined;
    if (id) accountByRef.set(o.externalId, id);
  }
  // A grant may also name the account by that key directly.
  for (const [key, id] of accountIdByKey) if (!accountByRef.has(key)) accountByRef.set(key, id);

  const app = { id: applicationId, name: appName };
  return {
    stagedEntitlements: stagedEnts.filter((o) => belongsToApplication(o.normalized ?? {}, app)).map((o) => ({ externalId: o.externalId, values: o.normalized ?? {} })),
    stagedGrants: stagedGrants.map((o) => ({ externalId: o.externalId, values: o.normalized ?? {} })),
    entitlements,
    grants,
    accountByRef,
    accountNames: new Map(accounts.map((a) => [a.id as string, ((a.account_name as string | null) ?? (a.external_account_ref as string)) as string])),
    entitlementNames: new Map(entitlements.map((e) => [e.id, e.name])),
  };
}

function samplesOf(ents: EntitlementPlan, grants: GrantPlan, accountNames: Map<string, string>, entitlementNames: Map<string, string>): AccessSamples {
  const newNames = new Map(ents.creates.map((c) => [`new:${c.ref}`, c.name]));
  const ent = (id: string) => entitlementNames.get(id) ?? newNames.get(id) ?? id;
  const pair = (g: { accountId: string; entitlementId: string }) => `${accountNames.get(g.accountId) ?? g.accountId} → ${ent(g.entitlementId)}`;
  return {
    entitlements: {
      added: ents.creates.slice(0, SAMPLES).map((c) => c.name),
      changed: ents.updates.slice(0, SAMPLES).map((u) => `${u.name}: ${u.changes.map((c) => `${c.field} ${c.from ?? "—"} → ${c.to ?? "—"}`).join("; ")}`),
      removed: ents.removed.slice(0, SAMPLES).map((r) => r.name),
      restored: ents.restored.slice(0, SAMPLES).map((r) => r.name),
      invalid: ents.invalid.slice(0, SAMPLES).map((i) => `${i.ref}: ${i.reason}`),
    },
    grants: {
      added: grants.creates.slice(0, SAMPLES).map(pair),
      removed: grants.removed.slice(0, SAMPLES).map(pair),
      restored: grants.restored.slice(0, SAMPLES).map(pair),
      unresolved: grants.unresolved.slice(0, SAMPLES).map((u) => `${u.ref}: ${u.reason}`),
    },
  };
}

async function applyEntitlements(admin: Admin, tenantId: string, applicationId: string, integrationId: string, plan: EntitlementPlan): Promise<void> {
  const now = new Date().toISOString();
  for (const part of chunks(plan.creates, 500)) {
    const { data, error } = await admin
      .from("entitlements")
      .insert(
        part.map((c) => ({
          tenant_id: tenantId,
          application_id: applicationId,
          name: c.name,
          privilege_level: c.privilegeLevel,
          data_classification: c.dataClassification,
          source_integration_id: integrationId,
          external_ref: c.ref,
        })),
      )
      .select("id, external_ref");
    if (error) throw new ApiError(500, "WRITE_FAILED", `entitlements: ${error.message}`);
    for (const r of (data ?? []) as Row[]) plan.byRef.set(r.external_ref as string, r.id as string);
  }
  for (const u of plan.updates) {
    const { error } = await admin.from("entitlements").update({ ...u.set, updated_at: now }).eq("tenant_id", tenantId).eq("id", u.id);
    if (error) throw new ApiError(500, "WRITE_FAILED", `entitlements: ${error.message}`);
  }
  for (const [ids, value] of [
    [plan.removed.map((r) => r.id), now],
    [plan.restored.map((r) => r.id), null],
  ] as const) {
    for (const part of chunks(ids, 500)) {
      const { error } = await admin.from("entitlements").update({ missing_from_source_at: value, updated_at: now }).eq("tenant_id", tenantId).in("id", part);
      if (error) throw new ApiError(500, "WRITE_FAILED", `entitlements: ${error.message}`);
    }
  }
}

async function applyGrants(admin: Admin, tenantId: string, integrationId: string, plan: GrantPlan, byRef: Map<string, string>): Promise<void> {
  const now = new Date().toISOString();
  // A grant on an entitlement this run created names it by `new:<ref>` until the insert gave it an id.
  const resolve = (id: string) => (id.startsWith("new:") ? byRef.get(id.slice(4)) : id);
  const rows = plan.creates.map((c) => ({ ...c, entitlementId: resolve(c.entitlementId) }));
  if (rows.some((r) => !r.entitlementId || r.entitlementId.startsWith("new:"))) throw new ApiError(500, "WRITE_FAILED", "A new entitlement was not created");
  for (const part of chunks(rows, 500)) {
    const { error } = await admin.from("access_grants").insert(
      part.map((c) => ({
        tenant_id: tenantId,
        account_id: c.accountId,
        entitlement_id: c.entitlementId,
        grant_type: c.grantType,
        source_integration_id: integrationId,
      })),
    );
    if (error) throw new ApiError(500, "WRITE_FAILED", `access_grants: ${error.message}`);
  }
  for (const [ids, value] of [
    [plan.removed.map((r) => r.id), now],
    [plan.restored.map((r) => r.id), null],
  ] as const) {
    for (const part of chunks(ids, 500)) {
      const { error } = await admin.from("access_grants").update({ missing_from_source_at: value, updated_at: now }).eq("tenant_id", tenantId).in("id", part);
      if (error) throw new ApiError(500, "WRITE_FAILED", `access_grants: ${error.message}`);
    }
  }
}
