import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { fieldChanges } from "@/lib/audit/changes";
import { ApiError } from "@/lib/shared/types/foundation";
import type { IdentitySource, PendingCorrelation, ReconciliationRun } from "@/lib/shared/types/integrations";
import type { IdentityType, SourcedFields } from "@/lib/shared/types/agent-identity";
import { inviteFromIdentitySource, rolesWithPermissions } from "@/lib/users/users";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { invitationEscalation } from "@/lib/users/userRules";
import { TENANT_ADMIN_ROLE } from "@/lib/rbac/delegatedRoleRules";
import { applySourcedIdentities, listAttributeDefinitions, listIdentitiesForCorrelation, revertSourceRecord, type SourcedOp, type SourcedResult } from "@/modules/agent-identity/service";
import {
  MAX_RECORDS_PER_RUN,
  correlate,
  normalizeRecord,
  parseCsv,
  planLeavers,
  validateSourceConfig,
  type NormalizedSourceRecord,
  type SourceConfigInput,
} from "./identitySourceRules";

/**
 * INTEGRATION-P0-08/09 — identity sources and their reconciliation runs.
 *
 * Configuration is written as the calling user (RLS + the route's
 * permission check). A run's results, the source links and the pending
 * correlations are integrity-sensitive, so only the worker writes them,
 * through the service role; every one of those statements carries an
 * explicit `tenant_id` filter or value (§14). Identity rows themselves are
 * written by the Identity module's applySourcedIdentities() (#6).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHANGES_LOGGED = 500;

/** Ends a preview run's pipeline after planning; not an error. */
class PreviewDone extends Error {}
const PERSON_TYPES: IdentityType[] = ["HUMAN", "EXTERNAL"];
const MACHINE_TYPES: IdentityType[] = ["MACHINE", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API"];

type Row = Record<string, unknown>;

function toSource(r: Row): IdentitySource {
  return {
    id: r.id as string,
    ref: r.ref === null || r.ref === undefined ? null : Number(r.ref),
    tenantId: r.tenant_id as string,
    name: r.name as string,
    template: r.template as IdentitySource["template"],
    integrationId: (r.integration_id as string | null) ?? null,
    identityType: r.identity_type as IdentitySource["identityType"],
    authoritative: Boolean(r.authoritative),
    priority: Number(r.priority),
    authoritativeFields: (r.authoritative_fields as IdentitySource["authoritativeFields"]) ?? [],
    attributeMappings: (r.attribute_mappings as IdentitySource["attributeMappings"]) ?? [],
    correlationRules: (r.correlation_rules as IdentitySource["correlationRules"]) ?? [],
    leaverStrategy: r.leaver_strategy as IdentitySource["leaverStrategy"],
    leaverThresholdPercent: Number(r.leaver_threshold_percent),
    schedule: r.schedule as IdentitySource["schedule"],
    status: r.status as IdentitySource["status"],
    defaultIdRole: (r.default_id_role as string | null) ?? null,
    defaultIdRoleSetBy: (r.default_id_role_set_by as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toRun(r: Row): ReconciliationRun {
  return {
    id: r.id as string,
    ref: r.ref === null || r.ref === undefined ? null : Number(r.ref),
    sourceId: r.source_id as string,
    trigger: r.trigger as ReconciliationRun["trigger"],
    mode: r.mode as ReconciliationRun["mode"],
    status: r.status as ReconciliationRun["status"],
    recordsSeen: Number(r.records_seen),
    recordsInvalid: Number(r.records_invalid),
    createdCount: Number(r.created_count),
    updatedCount: Number(r.updated_count),
    unchangedCount: Number(r.unchanged_count),
    pendingCount: Number(r.pending_count),
    leaverCount: Number(r.leaver_count),
    errorCount: Number(r.error_count),
    guardTripped: Boolean(r.guard_tripped),
    dryRun: Boolean(r.dry_run),
    errors: (r.errors as ReconciliationRun["errors"]) ?? [],
    changes: (r.changes as ReconciliationRun["changes"]) ?? [],
    startedAt: (r.started_at as string | null) ?? null,
    endedAt: (r.ended_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function toPending(r: Row): PendingCorrelation {
  return {
    id: r.id as string,
    sourceId: r.source_id as string,
    runId: (r.run_id as string | null) ?? null,
    externalId: r.external_id as string,
    normalized: (r.normalized as Record<string, unknown>) ?? {},
    candidateIdentityIds: (r.candidate_identity_ids as string[]) ?? [],
    reason: r.reason as string,
    status: r.status as PendingCorrelation["status"],
    resolvedIdentityId: (r.resolved_identity_id as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function writeError(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new ApiError(409, "CONFLICT", "A source with this name already exists");
  if (error.code === "23503") throw new ApiError(404, "NOT_FOUND", "That integration is not in this organization");
  if (error.code === "23514") throw new ApiError(400, "VALIDATION_FAILED", error.message);
  throw new ApiError(500, "WRITE_FAILED", error.message);
}

// ---------------------------------------------------------------- configuration

export async function listIdentitySources(tenantId: string): Promise<IdentitySource[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("identity_sources").select().eq("tenant_id", tenantId).order("priority").order("name").limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toSource);
}

export async function getIdentitySource(tenantId: string, sourceId: string): Promise<IdentitySource | null> {
  if (!UUID_RE.test(sourceId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("identity_sources").select().eq("tenant_id", tenantId).eq("id", sourceId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toSource(data) : null;
}

/** The settings a person edits, for the audit record's changes (FOUNDATION-P0-33). */
function sourceFields(s: IdentitySource): Record<string, unknown> {
  return {
    name: s.name,
    identityType: s.identityType,
    authoritative: s.authoritative,
    priority: s.priority,
    authoritativeFields: s.authoritativeFields,
    attributeMappings: s.attributeMappings,
    correlationRules: s.correlationRules,
    leaverStrategy: s.leaverStrategy,
    leaverThresholdPercent: s.leaverThresholdPercent,
    schedule: s.schedule,
    status: s.status,
  };
}

function configRow(c: ReturnType<typeof validateSourceConfig>) {
  return {
    name: c.name,
    template: c.template,
    integration_id: c.integrationId,
    identity_type: c.identityType,
    authoritative: c.authoritative,
    priority: c.priority,
    authoritative_fields: c.authoritativeFields,
    attribute_mappings: c.attributeMappings,
    correlation_rules: c.correlationRules,
    leaver_strategy: c.leaverStrategy,
    leaver_threshold_percent: c.leaverThresholdPercent,
    schedule: c.schedule,
    status: c.status,
  };
}

export async function createIdentitySource(tenantId: string, actorId: string, input: SourceConfigInput): Promise<IdentitySource> {
  const config = validateSourceConfig(input, await listAttributeDefinitions(tenantId));
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_sources")
    .insert({ tenant_id: tenantId, ...configRow(config), created_by: actorId })
    .select()
    .single();
  if (error || !data) writeError(error ?? { message: "Failed to create source" });
  const source = toSource(data);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity_source.created",
    objectType: "identity_source",
    objectId: source.id,
    outcome: "success",
    metadata: { name: source.name, template: source.template, authoritative: source.authoritative, priority: source.priority, authoritativeFields: source.authoritativeFields },
  });
  return source;
}

export async function updateIdentitySource(tenantId: string, actorId: string, sourceId: string, input: SourceConfigInput): Promise<IdentitySource> {
  const current = await getIdentitySource(tenantId, sourceId);
  if (!current) throw new ApiError(404, "NOT_FOUND", "No such identity source");
  // Only the keys given change; the template and its integration never do.
  const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const config = validateSourceConfig({ ...current, ...given, template: current.template, integrationId: current.integrationId }, await listAttributeDefinitions(tenantId));
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_sources")
    .update({ ...configRow(config), updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", sourceId)
    .select()
    .single();
  if (error || !data) writeError(error ?? { message: "Failed to update source" });
  const source = toSource(data);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity_source.updated",
    objectType: "identity_source",
    objectId: sourceId,
    outcome: "success",
    metadata: {
      authoritative: source.authoritative,
      priority: source.priority,
      authoritativeFields: source.authoritativeFields,
      leaverStrategy: source.leaverStrategy,
      status: source.status,
      changes: fieldChanges(sourceFields(current), sourceFields(source)),
    },
  });
  return source;
}

// ---------------------------------------------------------------- runs

export async function listReconciliationRuns(tenantId: string, sourceId: string, limit = 25): Promise<ReconciliationRun[]> {
  if (!UUID_RE.test(sourceId)) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_reconciliation_runs")
    .select()
    .eq("tenant_id", tenantId)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toRun);
}

export async function getReconciliationRun(tenantId: string, runId: string): Promise<ReconciliationRun | null> {
  if (!UUID_RE.test(runId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("identity_reconciliation_runs").select().eq("tenant_id", tenantId).eq("id", runId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toRun(data) : null;
}

export type ReconciliationInput = ({ kind: "upload"; csvText: string } | { kind: "integration" }) & { mode: "full" | "partial"; dryRun?: boolean };

/**
 * Validates the request, queues a run, and returns it with the work to do.
 * The caller hands `execute` to `after()` so the request returns at once
 * with a run the page can show as queued/running (§15, §17.5). A CSV is
 * parsed here, so a malformed file is refused before any run exists.
 */
export async function startReconciliation(
  tenantId: string,
  actorId: string,
  sourceId: string,
  input: ReconciliationInput,
): Promise<{ run: ReconciliationRun; execute: () => Promise<void> }> {
  const source = await getIdentitySource(tenantId, sourceId);
  if (!source) throw new ApiError(404, "NOT_FOUND", "No such identity source");
  if (source.status !== "active") throw new ApiError(409, "SOURCE_PAUSED", "This source is paused; resume it before importing");
  if (input.mode !== "full" && input.mode !== "partial") throw new ApiError(400, "VALIDATION_FAILED", "mode: full or partial");

  let records: Record<string, unknown>[] | null = null;
  if (input.kind === "upload") {
    if (source.template === "integration") throw new ApiError(400, "VALIDATION_FAILED", "This source reads from its integration; run it from there");
    if (typeof input.csvText !== "string" || !input.csvText.trim()) throw new ApiError(400, "VALIDATION_FAILED", "file: choose a CSV file");
    if (input.csvText.length > 5_000_000) throw new ApiError(400, "VALIDATION_FAILED", "file: at most 5 MB");
    const { headers, rows } = parseCsv(input.csvText);
    const missing = source.attributeMappings.filter((m) => !headers.includes(m.source)).map((m) => m.source);
    if (missing.length) throw new ApiError(400, "VALIDATION_FAILED", `file: missing mapped column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}`);
    records = rows;
  } else if (!source.integrationId) {
    throw new ApiError(400, "VALIDATION_FAILED", "This source has no integration to read from");
  }

  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("identity_reconciliation_runs")
    .insert({ tenant_id: tenantId, source_id: source.id, trigger: input.kind === "upload" ? "upload" : "integration", mode: input.mode, dry_run: input.dryRun === true, created_by: actorId })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to queue the run");
  const run = toRun(data);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity_source.run_started",
    objectType: "identity_source",
    objectId: source.id,
    outcome: "success",
    correlationId: run.id,
    metadata: { runId: run.id, trigger: run.trigger, mode: run.mode, dryRun: run.dryRun, records: records?.length ?? null },
  });
  return { run, execute: async () => void (await executeReconciliation(tenantId, actorId, source, run.id, run.mode, records, run.dryRun)) };
}

async function loadIntegrationRecords(tenantId: string, integrationId: string): Promise<Record<string, unknown>[]> {
  const supabase = supabaseServiceRole();
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_RECORDS_PER_RUN; from += 1000) {
    const { data, error } = await supabase
      .from("integration_objects")
      .select("external_id, raw, normalized")
      .eq("tenant_id", tenantId)
      .eq("integration_id", integrationId)
      .eq("object_type", "identity")
      // INTEGRATION-P0-18: an identity gone from the source is not read, so a full run treats it as a leaver.
      .is("missing_at_source_at", null)
      .order("external_id")
      .range(from, Math.min(from + 999, MAX_RECORDS_PER_RUN - 1));
    if (error) throw new Error(`reading the integration's identities: ${error.message}`);
    // The raw record, plus the connector's normalized view under
    // `normalized.*` and its own id under `externalId`.
    for (const r of data ?? []) out.push({ externalId: r.external_id, ...(r.raw as Row), normalized: r.normalized });
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * The pipeline: validate → normalize → correlate → compare and apply
 * (Identity module) → link → leavers (guarded) → record the run → audit.
 * Anything that throws marks the run failed with its reason; leavers are
 * decided only after every record has been handled, so a failed or
 * truncated run never disables anyone.
 */
export async function executeReconciliation(
  tenantId: string,
  actorId: string | null,
  source: IdentitySource,
  runId: string,
  mode: "full" | "partial",
  given: Record<string, unknown>[] | null,
  dryRun = false,
): Promise<ReconciliationOutcome> {
  const supabase = supabaseServiceRole();
  const startedAt = new Date().toISOString();
  await supabase.from("identity_reconciliation_runs").update({ status: "running", started_at: startedAt }).eq("tenant_id", tenantId).eq("id", runId);

  const errors: { ref?: string; message: string }[] = [];
  const changes: ReconciliationRun["changes"] = [];
  const counts = { seen: 0, invalid: 0, created: 0, updated: 0, unchanged: 0, pending: 0, leavers: 0, errors: 0 };
  let guardTripped = false;
  let status: ReconciliationRun["status"] = "succeeded";

  try {
    const raw = given ?? (await loadIntegrationRecords(tenantId, source.integrationId!));
    counts.seen = raw.length;

    // 1. Validate and normalize; a repeated external id is invalid, not a second person.
    const valid: NormalizedSourceRecord[] = [];
    const seen = new Set<string>();
    raw.forEach((r, i) => {
      const n = normalizeRecord(r, source.attributeMappings);
      if ("invalid" in n) {
        counts.invalid++;
        if (errors.length < 200) errors.push({ ref: `row ${i + 1}`, message: n.invalid });
        return;
      }
      if (seen.has(n.externalId)) {
        counts.invalid++;
        if (errors.length < 200) errors.push({ ref: n.externalId, message: "external id appears more than once" });
        return;
      }
      seen.add(n.externalId);
      valid.push(n);
    });

    // 2. The source's links, and the identities it may correlate with.
    const links = new Map<string, { identityId: string; present: boolean }>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("identity_source_links")
        .select("external_id, identity_id, present")
        .eq("tenant_id", tenantId)
        .eq("source_id", source.id)
        .order("external_id")
        .range(from, from + 999);
      if (error) throw new Error(`reading source links: ${error.message}`);
      for (const l of data ?? []) links.set(l.external_id as string, { identityId: l.identity_id as string, present: Boolean(l.present) });
      if (!data || data.length < 1000) break;
    }
    // WID-H01: the identities each record was unlinked from.
    const rejections = new Map<string, Set<string>>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("identity_source_rejections")
        .select("external_id, identity_id")
        .eq("tenant_id", tenantId)
        .eq("source_id", source.id)
        .order("external_id")
        .order("identity_id")
        .range(from, from + 999);
      if (error) throw new Error(`reading unlinked records: ${error.message}`);
      for (const r of data ?? []) {
        const set = rejections.get(r.external_id as string) ?? new Set<string>();
        set.add(r.identity_id as string);
        rejections.set(r.external_id as string, set);
      }
      if (!data || data.length < 1000) break;
    }
    const types = PERSON_TYPES.includes(source.identityType as IdentityType) ? PERSON_TYPES : MACHINE_TYPES;
    const index = await listIdentitiesForCorrelation(tenantId, types);
    const taken = new Set([...links.values()].map((l) => l.identityId));

    // 3. Correlate.
    const ops: SourcedOp[] = [];
    const matched = new Map<string, string>();
    const pendings: { record: NormalizedSourceRecord; candidateIds: string[]; reason: string }[] = [];
    for (const record of valid) {
      const outcome = correlate(record, source.correlationRules, index, links.get(record.externalId)?.identityId ?? null, taken, rejections.get(record.externalId));
      if (outcome.kind === "linked" || outcome.kind === "matched") {
        if (outcome.kind === "matched") {
          taken.add(outcome.identityId);
          matched.set(record.externalId, outcome.identityId);
        }
        ops.push({ op: "update", ref: record.externalId, identityId: outcome.identityId, fields: record.fields, attributes: record.attributes });
      } else if (outcome.kind === "new") {
        ops.push({ op: "create", ref: record.externalId, identityType: source.identityType as IdentityType, fields: record.fields, attributes: record.attributes });
      } else {
        pendings.push({ record, candidateIds: outcome.candidateIds, reason: outcome.reason });
      }
    }

    // Preview (the "stage" step): report the plan and change nothing.
    if (dryRun) {
      const plannedCreates = ops.filter((o) => o.op === "create");
      const plannedUpdates = ops.filter((o) => o.op === "update");
      counts.created = plannedCreates.length;
      counts.updated = plannedUpdates.length;
      counts.pending = pendings.length;
      for (const o of ops) if (changes.length < MAX_CHANGES_LOGGED) changes.push({ ref: o.ref, identityId: o.op === "update" ? o.identityId : null, action: o.op === "create" ? "would_create" : "would_compare" });
      for (const p of pendings) if (changes.length < MAX_CHANGES_LOGGED) changes.push({ ref: p.record.externalId, identityId: null, action: "would_hold" });
      if (mode === "full" && source.leaverStrategy !== "none") {
        const presentLinks = [...links.entries()].filter(([, l]) => l.present).map(([externalId, l]) => ({ externalId, identityId: l.identityId }));
        const plan = planLeavers(presentLinks, seen, source.leaverThresholdPercent);
        guardTripped = plan.guardTripped;
        counts.leavers = plan.leavers.length;
        for (const l of plan.leavers) if (changes.length < MAX_CHANGES_LOGGED) changes.push({ ref: l.externalId, identityId: l.identityId, action: "would_leave" });
        if (guardTripped) errors.push({ message: `A real run would apply no leavers: more than ${source.leaverThresholdPercent}% of linked identities are missing.` });
      }
      if (counts.invalid || guardTripped) status = "partial";
      throw new PreviewDone();
    }

    // 4. Compare and apply, in the Identity module.
    const authority = {
      sourceId: source.id,
      priority: source.priority,
      authoritativeFields: source.authoritative ? source.authoritativeFields : [],
      ownsAttributes: source.authoritative,
      sourceName: source.name,
      runId,
    };
    const results: SourcedResult[] = [];
    for (let i = 0; i < ops.length; i += 500) results.push(...(await applySourcedIdentities(tenantId, authority, ops.slice(i, i + 500))));

    // 5. Link every record that now has an identity.
    const now = new Date().toISOString();
    const linkRows: Row[] = [];
    for (const r of results) {
      if (r.action === "error" || !r.identityId) continue;
      linkRows.push({ tenant_id: tenantId, source_id: source.id, external_id: r.ref, identity_id: r.identityId, present: true, last_seen_at: now, last_run_id: runId });
      links.set(r.ref, { identityId: r.identityId, present: true });
    }
    for (let i = 0; i < linkRows.length; i += 500) {
      const { error } = await supabase.from("identity_source_links").upsert(linkRows.slice(i, i + 500), { onConflict: "source_id,external_id" });
      if (error) throw new Error(`recording source links: ${error.message}`);
    }

    // 6. Managers, now that every record in this run has an identity.
    const managerOps: SourcedOp[] = [];
    for (const record of valid) {
      if (!record.managerExternalId) continue;
      const self = links.get(record.externalId)?.identityId;
      const manager = links.get(record.managerExternalId)?.identityId;
      if (self && manager && self !== manager) managerOps.push({ op: "update", ref: record.externalId, identityId: self, fields: { managerIdentityId: manager } });
    }
    if (managerOps.length) {
      for (const r of await applySourcedIdentities(tenantId, authority, managerOps)) {
        if (r.action === "error" && errors.length < 200) errors.push({ ref: r.ref, message: `manager: ${r.error}` });
      }
    }

    // 7. Ambiguous matches wait for a person; never merged silently. One
    // open row per record: a later run refreshes it rather than adding one.
    for (const p of pendings) {
      const normalized = {
        ...p.record.fields,
        ...(p.record.managerExternalId ? { managerExternalId: p.record.managerExternalId } : {}),
        ...(Object.keys(p.record.attributes).length ? { attributes: p.record.attributes } : {}),
      };
      const { data: refreshed, error: updateError } = await supabase
        .from("pending_identity_correlations")
        .update({ run_id: runId, normalized, candidate_identity_ids: p.candidateIds, reason: p.reason })
        .eq("tenant_id", tenantId)
        .eq("source_id", source.id)
        .eq("external_id", p.record.externalId)
        .eq("status", "pending")
        .select("id");
      if (updateError) throw new Error(`recording a pending correlation: ${updateError.message}`);
      if (!refreshed?.length) {
        const { error } = await supabase.from("pending_identity_correlations").insert({
          tenant_id: tenantId,
          source_id: source.id,
          run_id: runId,
          external_id: p.record.externalId,
          normalized,
          candidate_identity_ids: p.candidateIds,
          reason: p.reason,
        });
        if (error) throw new Error(`recording a pending correlation: ${error.message}`);
      }
      counts.pending++;
      if (changes.length < MAX_CHANGES_LOGGED) changes.push({ ref: p.record.externalId, identityId: null, action: "pending" });
    }

    for (const r of results) {
      if (r.action === "created") counts.created++;
      else if (r.action === "updated") counts.updated++;
      else if (r.action === "unchanged") counts.unchanged++;
      else if (r.action === "error") {
        counts.errors++;
        if (errors.length < 200) errors.push({ ref: r.ref, message: r.error ?? "failed" });
      }
      if (r.action !== "unchanged" && changes.length < MAX_CHANGES_LOGGED) changes.push({ ref: r.ref, identityId: r.identityId, action: r.action, changed: r.changed });
      // IDENTITY-P0-18: the change applied, but its lifecycle record did not.
      if (r.lifecycleError) {
        counts.errors++;
        if (errors.length < 200) errors.push({ ref: r.ref, message: `lifecycle: ${r.lifecycleError}` });
      }
      // WID-H01: reported, but not counted: a review list that missed an
      // update does not make the import itself unsafe, nor hold back leavers.
      if (r.conflictsError && errors.length < 200) errors.push({ ref: r.ref, message: `disagreements: ${r.conflictsError}` });
    }

    // 7b. Owner decision 2026-10-14: each new person with an e-mail is
    // invited to WonderID with the source's default ID role. A refusal is
    // reported, never fatal: the identity itself was imported.
    if (source.defaultIdRole && source.defaultIdRoleSetBy && source.identityType === "HUMAN") {
      const created = new Map(ops.filter((o) => o.op === "create").map((o) => [o.ref, o.fields]));
      for (const r of results) {
        if (r.action !== "created") continue;
        const f = created.get(r.ref);
        const email = f?.email?.trim();
        if (!email) continue;
        const sent = await inviteFromIdentitySource(
          tenantId,
          { id: source.id, defaultIdRole: source.defaultIdRole, defaultIdRoleSetBy: source.defaultIdRoleSetBy },
          { email, displayName: f?.displayName?.trim() || email, jobTitle: f?.title ?? null, department: f?.department ?? null },
        ).catch((err: unknown) => ({ outcome: "refused" as const, message: err instanceof Error ? err.message : "failed" }));
        if (sent.outcome === "refused" && errors.length < 200) errors.push({ ref: r.ref, message: `WonderID invitation: ${sent.message ?? "refused"}` });
      }
    }

    // 8. Leavers: only after a full run with every record handled.
    if (mode === "full" && source.leaverStrategy !== "none" && counts.errors === 0) {
      const presentLinks = [...links.entries()].filter(([, l]) => l.present).map(([externalId, l]) => ({ externalId, identityId: l.identityId }));
      const plan = planLeavers(presentLinks, seen, source.leaverThresholdPercent);
      guardTripped = plan.guardTripped;
      if (guardTripped) {
        errors.push({ message: `Leavers not applied: more than ${source.leaverThresholdPercent}% of linked identities are missing from this run. Check the file, then run it again.` });
      } else if (plan.leavers.length) {
        if (source.leaverStrategy === "disable") {
          const leaverResults = await applySourcedIdentities(
            tenantId,
            authority,
            plan.leavers.map((l) => ({ op: "leaver" as const, ref: l.externalId, identityId: l.identityId })),
          );
          for (const r of leaverResults) {
            if (r.action === "leaver") counts.leavers++;
            if (r.action === "error") {
              counts.errors++;
              if (errors.length < 200) errors.push({ ref: r.ref, message: r.error ?? "leaver failed" });
            }
            if (r.action !== "unchanged" && changes.length < MAX_CHANGES_LOGGED) changes.push({ ref: r.ref, identityId: r.identityId, action: r.action });
            if (r.lifecycleError && errors.length < 200) errors.push({ ref: r.ref, message: `lifecycle: ${r.lifecycleError}` });
          }
        } else if (source.leaverStrategy === "flag") {
          counts.leavers = plan.leavers.length;
          for (const l of plan.leavers) if (changes.length < MAX_CHANGES_LOGGED) changes.push({ ref: l.externalId, identityId: l.identityId, action: "missing" });
        }
        {
          const absentIds = plan.leavers.map((l) => l.externalId);
          for (let i = 0; i < absentIds.length; i += 500) {
            const { error } = await supabase
              .from("identity_source_links")
              .update({ present: false, last_run_id: runId })
              .eq("tenant_id", tenantId)
              .eq("source_id", source.id)
              .in("external_id", absentIds.slice(i, i + 500));
            if (error) throw new Error(`marking leavers: ${error.message}`);
          }
        }
      }
    }
    if (counts.invalid || counts.errors || guardTripped) status = "partial";
  } catch (err) {
    if (!(err instanceof PreviewDone)) {
      status = "failed";
      errors.push({ message: err instanceof Error ? err.message.slice(0, 500) : "The run failed" });
    }
  }

  await supabase
    .from("identity_reconciliation_runs")
    .update({
      status,
      records_seen: counts.seen,
      records_invalid: counts.invalid,
      created_count: counts.created,
      updated_count: counts.updated,
      unchanged_count: counts.unchanged,
      pending_count: counts.pending,
      leaver_count: counts.leavers,
      error_count: counts.errors,
      guard_tripped: guardTripped,
      errors: errors.slice(0, 200),
      changes,
      ended_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", runId);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "integration",
    action: "identity_source.run_completed",
    objectType: "identity_source",
    objectId: source.id,
    outcome: status === "failed" ? "failure" : "success",
    correlationId: runId,
    metadata: { runId, status, dryRun, ...counts, guardTripped },
  });
  return { runId, status, counts, guardTripped, error: status === "failed" ? (errors[errors.length - 1]?.message ?? "The run failed") : null };
}

/** What a reconciliation run ended with (INTEGRATION-P0-19 shows it on the sync job). */
export type ReconciliationOutcome = {
  runId: string;
  status: ReconciliationRun["status"];
  counts: { seen: number; invalid: number; created: number; updated: number; unchanged: number; pending: number; leavers: number; errors: number };
  guardTripped: boolean;
  error: string | null;
};

/**
 * INTEGRATION-P0-19: the active identity sources that read this
 * connection's staged identities, for the post-sync chain. Service role;
 * `tenantId` is the connection's own (from the job row).
 */
export async function listSourcesReadingConnection(tenantId: string, integrationId: string): Promise<IdentitySource[]> {
  const { data, error } = await supabaseServiceRole()
    .from("identity_sources")
    .select()
    .eq("tenant_id", tenantId)
    .eq("integration_id", integrationId)
    .eq("template", "integration")
    .eq("status", "active")
    .order("priority")
    .limit(50);
  if (error) throw new Error(`reading the connection's identity sources: ${error.message}`);
  return (data ?? []).filter((r) => r.tenant_id === tenantId).map(toSource);
}

/**
 * INTEGRATION-P0-19: a full reconciliation of a source from its
 * connection's staging, started by WonderID after a sync (no person).
 * Queued and audited as the system, then run to the end; the outcome is
 * returned, never thrown, so the chain can record it.
 */
export async function runSourceAfterSync(tenantId: string, source: IdentitySource, syncJobId: string | null): Promise<ReconciliationOutcome> {
  const { data, error } = await supabaseServiceRole()
    .from("identity_reconciliation_runs")
    .insert({ tenant_id: tenantId, source_id: source.id, trigger: "integration", mode: "full", dry_run: false, created_by: null })
    .select("id")
    .single();
  if (error || !data) {
    return { runId: "", status: "failed", counts: { seen: 0, invalid: 0, created: 0, updated: 0, unchanged: 0, pending: 0, leavers: 0, errors: 0 }, guardTripped: false, error: "The run could not be queued" };
  }
  await writeAudit({
    tenantId,
    actorType: "system",
    action: "identity_source.run_started",
    objectType: "identity_source",
    objectId: source.id,
    outcome: "success",
    correlationId: data.id,
    metadata: { runId: data.id, trigger: "integration", mode: "full", dryRun: false, syncJobId, ...(syncJobId ? {} : { pushed: true }) },
  });
  return executeReconciliation(tenantId, null, source, data.id, "full", null, false);
}

/**
 * INTEGRATION-P0-22: a system pushed identities to the connection (SCIM).
 * Each source reading it is asked to run; runs of one source never
 * overlap (two at once could create the same person twice). Whoever holds
 * the source's claim runs it again while requests arrived after its last
 * start; everyone else only records the request. Never throws.
 */
export async function runSourcesAfterPush(tenantId: string, integrationId: string): Promise<void> {
  let sources: IdentitySource[];
  try {
    sources = await listSourcesReadingConnection(tenantId, integrationId);
  } catch (err) {
    console.error("runSourcesAfterPush: sources unreadable", { integrationId, err: err instanceof Error ? err.message : "unknown" });
    return;
  }
  const admin = supabaseServiceRole();
  for (const source of sources) {
    await admin.from("identity_sources").update({ run_requested_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", source.id);
    for (let attempt = 0; attempt < 2; attempt++) {
      const lastStart = await drainSource(tenantId, source.id);
      if (lastStart === null) break;
      // A request that arrived between the last check and the release is run now.
      const { data } = await admin.from("identity_sources").select("run_requested_at").eq("tenant_id", tenantId).eq("id", source.id).maybeSingle();
      if (!data?.run_requested_at || (data.run_requested_at as string) <= lastStart) break;
    }
  }
}

const CLAIM_TTL_MS = 10 * 60_000;
const MAX_PUSH_RUNS = 5;

/** Runs the source while it holds the claim; the start of its last run, or null when another worker holds it. */
async function drainSource(tenantId: string, sourceId: string): Promise<string | null> {
  const admin = supabaseServiceRole();
  const claimedAt = new Date().toISOString();
  const stale = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const { data: claimed } = await admin
    .from("identity_sources")
    .update({ run_claimed_at: claimedAt })
    .eq("tenant_id", tenantId)
    .eq("id", sourceId)
    .or(`run_claimed_at.is.null,run_claimed_at.lt.${stale}`)
    .select("id");
  if (!claimed?.length) return null;
  let lastStart = claimedAt;
  try {
    for (let i = 0; i < MAX_PUSH_RUNS; i++) {
      const source = await getIdentitySource(tenantId, sourceId);
      if (!source || source.status !== "active") break;
      lastStart = new Date().toISOString();
      await runSourceAfterSync(tenantId, source, null);
      const { data } = await admin.from("identity_sources").select("run_requested_at").eq("tenant_id", tenantId).eq("id", sourceId).maybeSingle();
      if (!data?.run_requested_at || (data.run_requested_at as string) <= lastStart) break;
    }
  } finally {
    await admin.from("identity_sources").update({ run_claimed_at: null }).eq("tenant_id", tenantId).eq("id", sourceId).eq("run_claimed_at", claimedAt);
  }
  return lastStart;
}

// ---------------------------------------------------------------- pending correlations

export async function listPendingCorrelations(
  tenantId: string,
  filter: { status?: PendingCorrelation["status"]; sourceId?: string } = {},
  limit = 100,
): Promise<PendingCorrelation[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("pending_identity_correlations").select().eq("tenant_id", tenantId);
  query = query.eq("status", filter.status ?? "pending");
  if (filter.sourceId && UUID_RE.test(filter.sourceId)) query = query.eq("source_id", filter.sourceId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(Math.min(limit, 500));
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPending);
}

export async function countPendingCorrelations(tenantId: string): Promise<number> {
  const supabase = await supabaseServer();
  const { count, error } = await supabase
    .from("pending_identity_correlations")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pending");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return count ?? 0;
}

export type CorrelationDecision = { action: "link"; identityId: string } | { action: "create" } | { action: "dismiss" };

/**
 * A person decides an ambiguous match (§17.6). The row is claimed first
 * (pending → the decision, only if still pending), so two reviewers
 * cannot both act on it; if the identity change then fails, the claim is
 * released and the error returned (§17.5). Linking is limited to the
 * candidates the run found.
 */
export async function resolvePendingCorrelation(tenantId: string, actorId: string, pendingId: string, decision: CorrelationDecision): Promise<PendingCorrelation> {
  if (!UUID_RE.test(pendingId)) throw new ApiError(404, "NOT_FOUND", "No such pending match");
  if (!decision || !["link", "create", "dismiss"].includes(decision.action)) throw new ApiError(400, "VALIDATION_FAILED", "action: link, create or dismiss");
  const supabase = supabaseServiceRole();
  const { data: row, error } = await supabase.from("pending_identity_correlations").select().eq("tenant_id", tenantId).eq("id", pendingId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!row) throw new ApiError(404, "NOT_FOUND", "No such pending match");
  const pending = toPending(row);
  if (pending.status !== "pending") throw new ApiError(409, "ALREADY_RESOLVED", "This match has already been decided");
  if (decision.action === "link" && !pending.candidateIdentityIds.includes(decision.identityId)) {
    throw new ApiError(400, "VALIDATION_FAILED", "identityId: choose one of the candidate identities");
  }

  const { data: srcRow, error: srcError } = await supabase.from("identity_sources").select().eq("tenant_id", tenantId).eq("id", pending.sourceId).maybeSingle();
  if (srcError || !srcRow) throw new ApiError(404, "NOT_FOUND", "The source of this match no longer exists");
  const source = toSource(srcRow);

  const claimedStatus = decision.action === "link" ? "linked" : decision.action === "create" ? "created" : "dismissed";
  const { data: claimed, error: claimError } = await supabase
    .from("pending_identity_correlations")
    .update({ status: claimedStatus, resolved_by: actorId, resolved_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", pendingId)
    .eq("status", "pending")
    .select("id");
  if (claimError) throw new ApiError(500, "UPDATE_FAILED", claimError.message);
  if (!claimed?.length) throw new ApiError(409, "ALREADY_RESOLVED", "This match has already been decided");

  const release = () =>
    supabase.from("pending_identity_correlations").update({ status: "pending", resolved_by: null, resolved_at: null }).eq("tenant_id", tenantId).eq("id", pendingId);

  let identityId: string | null = null;
  if (decision.action !== "dismiss") {
    try {
      const fields = { ...pending.normalized } as SourcedFields & { managerExternalId?: string; attributes?: Record<string, string | null> };
      const attributes = fields.attributes;
      delete fields.managerExternalId;
      delete fields.attributes;
      const authority = {
        sourceId: source.id,
        priority: source.priority,
        authoritativeFields: source.authoritative ? source.authoritativeFields : [],
        ownsAttributes: source.authoritative,
        sourceName: source.name,
        runId: pending.runId ?? pendingId,
      };
      const op: SourcedOp =
        decision.action === "link"
          ? { op: "update", ref: pending.externalId, identityId: decision.identityId, fields, attributes }
          : { op: "create", ref: pending.externalId, identityType: source.identityType as IdentityType, fields, attributes };
      const [result] = await applySourcedIdentities(tenantId, authority, [op]);
      if (!result || result.action === "error" || !result.identityId) throw new ApiError(400, "APPLY_FAILED", result?.error ?? "The identity could not be updated");
      identityId = result.identityId;
      const { error: linkError } = await supabase.from("identity_source_links").insert({
        tenant_id: tenantId,
        source_id: source.id,
        external_id: pending.externalId,
        identity_id: identityId,
        present: true,
        last_run_id: pending.runId,
      });
      if (linkError?.code === "23505") throw new ApiError(409, "ALREADY_LINKED", "That identity or record is already linked to this source");
      if (linkError) throw new ApiError(500, "WRITE_FAILED", linkError.message);
      // WID-H01: a person linking it back overrides an earlier unlink.
      if (decision.action === "link") {
        await supabase
          .from("identity_source_rejections")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("source_id", source.id)
          .eq("external_id", pending.externalId)
          .eq("identity_id", identityId);
      }
    } catch (err) {
      await release();
      throw err;
    }
    await supabase.from("pending_identity_correlations").update({ resolved_identity_id: identityId }).eq("tenant_id", tenantId).eq("id", pendingId);
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity_source.correlation_resolved",
    objectType: "identity_source",
    objectId: source.id,
    outcome: "success",
    metadata: { pendingId, decision: decision.action, identityId },
    // WID-H07, identifiers only: a source's record id may be an email.
    typedText: { externalId: pending.externalId },
  });
  return { ...pending, status: claimedStatus, resolvedIdentityId: identityId };
}

// ---------------------------------------------------------------- unlink (WID-H01)

/** The records sources have linked to one identity, for its page. Read as the user (RLS), filtered by tenant. */
export async function listSourceLinksForIdentity(tenantId: string, identityId: string): Promise<{ sourceId: string; sourceName: string; externalId: string; present: boolean; lastSeenAt: string }[]> {
  if (!UUID_RE.test(identityId)) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_source_links")
    .select("source_id, external_id, present, last_seen_at")
    .eq("tenant_id", tenantId)
    .eq("identity_id", identityId)
    .limit(50);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const sources = new Map((await listIdentitySources(tenantId)).map((s) => [s.id, s.name]));
  return (data ?? []).map((l) => ({
    sourceId: l.source_id as string,
    sourceName: sources.get(l.source_id as string) ?? "A source",
    externalId: l.external_id as string,
    present: Boolean(l.present),
    lastSeenAt: l.last_seen_at as string,
  }));
}

/**
 * WID-H01 (owner decision): unlinks a source record from the identity it
 * was matched to, with undo. In order:
 * 1. the values the record changed on the identity are restored (Identity's
 *    revertSourceRecord), unless they changed since;
 * 2. the identity is recorded as one the record was unlinked from, so
 *    matching never links them again by itself;
 * 3. the link is removed: the next run matches the record afresh, and a
 *    match only to this identity waits in Pending Matches for a person.
 * The identity is not deleted. When its email, username or name came back,
 * its automatically matched accounts are matched afresh by their next
 * reconciliation (Access's requestAccountRematch). Audited.
 */
/** The identity values accounts are matched on (an account's correlation rule). */
const MATCHED_ON = new Set(["email", "username", "displayName"]);

export async function unlinkSourceRecord(
  tenantId: string,
  actorId: string,
  sourceId: string,
  externalId: unknown,
): Promise<{ identityId: string; restored: string[]; kept: string[]; accountsToRematch: number; rematchError?: string }> {
  if (!UUID_RE.test(sourceId)) throw new ApiError(404, "NOT_FOUND", "No such identity source");
  if (typeof externalId !== "string" || !externalId.trim() || externalId.length > 300) throw new ApiError(400, "VALIDATION_FAILED", "externalId: the source record's id");
  const supabase = supabaseServiceRole();
  const { data: link, error } = await supabase
    .from("identity_source_links")
    .select("identity_id")
    .eq("tenant_id", tenantId)
    .eq("source_id", sourceId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!link) throw new ApiError(404, "NOT_FOUND", "That record is not linked to anyone");
  const identityId = link.identity_id as string;

  let undo: { restored: string[]; kept: string[] };
  try {
    undo = await revertSourceRecord(tenantId, actorId, { identityId, sourceId, externalId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "the values could not be restored";
    throw new ApiError(/changed meanwhile/.test(message) ? 409 : 500, "UNDO_FAILED", `Nothing was unlinked: ${message.slice(0, 200)}`);
  }
  const { error: rejectError } = await supabase
    .from("identity_source_rejections")
    .upsert({ tenant_id: tenantId, source_id: sourceId, external_id: externalId, identity_id: identityId, rejected_by: actorId }, { onConflict: "source_id,external_id,identity_id" });
  if (rejectError) throw new ApiError(500, "WRITE_FAILED", `The values were restored, but the record is still linked: ${rejectError.message}`);
  const { error: deleteError } = await supabase
    .from("identity_source_links")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("source_id", sourceId)
    .eq("external_id", externalId)
    .eq("identity_id", identityId);
  if (deleteError) throw new ApiError(500, "WRITE_FAILED", `The values were restored, but the record is still linked: ${deleteError.message}`);
  // WID-H01: the values accounts match on came back, so the person's automatically matched accounts are matched afresh.
  // Loaded at call time: the Access service already imports this module's service.
  let accountsToRematch = 0;
  let rematchError: string | undefined;
  if (undo.restored.some((f) => MATCHED_ON.has(f))) {
    try {
      const { requestAccountRematch } = await import("@/modules/access-governance/service");
      accountsToRematch = await requestAccountRematch(tenantId, identityId);
    } catch (err) {
      rematchError = err instanceof Error ? err.message.slice(0, 200) : "accounts not queued for matching";
    }
  }
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity_source.record_unlinked",
    objectType: "identity",
    objectId: identityId,
    outcome: "success",
    metadata: { sourceId, restored: undo.restored, kept: undo.kept, accountsToRematch, ...(rematchError ? { rematchError } : {}) },
    // WID-H07, identifiers only: a source's record id may be an email.
    typedText: { externalId },
  });
  return { identityId, ...undo, accountsToRematch, ...(rematchError ? { rematchError } : {}) };
}

/**
 * Owner decision 2026-10-14 — sets (or clears, with null) the ID role an
 * identity source's new people are invited with. Only an assignable role,
 * never the organization administrator's, and only by someone holding every
 * permission it carries (no escalation, as for any invitation). Audited.
 */
export async function setSourceDefaultIdRole(
  tenantId: string,
  actor: { userId: string; permissions: readonly string[] },
  sourceId: string,
  role: unknown,
): Promise<IdentitySource> {
  const current = await getIdentitySource(tenantId, sourceId);
  if (!current) throw new ApiError(404, "NOT_FOUND", "No such identity source");
  const name = role === null || role === "" ? null : typeof role === "string" ? role.trim() : "";
  if (name !== null) {
    if (!name) throw new ApiError(400, "VALIDATION_FAILED", "role: an ID role name, or empty for none");
    if (name === TENANT_ADMIN_ROLE) throw new ApiError(400, "VALIDATION_FAILED", "role: the organization administrator role is never given automatically");
    if (!(await listAssignableRoles(tenantId)).some((r) => r.name === name)) throw new ApiError(400, "VALIDATION_FAILED", "role: one of this organization's active ID roles");
    const [withPermissions] = await rolesWithPermissions(tenantId, [name]);
    const escalated = invitationEscalation(withPermissions?.permissions ?? [], actor.permissions);
    if (escalated.length) throw new ApiError(403, "ROLE_ESCALATION", `You can only choose an ID role whose permissions you hold. Not held: ${escalated.join(", ")}`);
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_sources")
    .update({ default_id_role: name, default_id_role_set_by: name ? actor.userId : null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", sourceId)
    .select()
    .single();
  if (error || !data) writeError(error ?? { message: "Failed to update source" });
  await writeAudit({
    tenantId,
    actorId: actor.userId,
    actorType: "user",
    action: "identity_source.default_id_role_set",
    objectType: "identity_source",
    objectId: sourceId,
    outcome: "success",
    metadata: { from: current.defaultIdRole ?? null, to: name },
  });
  return toSource(data);
}
