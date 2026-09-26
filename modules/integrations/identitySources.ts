import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { IdentitySource, PendingCorrelation, ReconciliationRun } from "@/lib/shared/types/integrations";
import type { IdentityType, SourcedFields } from "@/lib/shared/types/agent-identity";
import { applySourcedIdentities, listIdentitiesForCorrelation, type SourcedOp, type SourcedResult } from "@/modules/agent-identity/service";
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
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toRun(r: Row): ReconciliationRun {
  return {
    id: r.id as string,
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
  const config = validateSourceConfig(input);
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
  const config = validateSourceConfig({ ...current, ...given, template: current.template, integrationId: current.integrationId });
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
  return { run, execute: () => executeReconciliation(tenantId, actorId, source, run.id, run.mode, records, run.dryRun) };
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
  actorId: string,
  source: IdentitySource,
  runId: string,
  mode: "full" | "partial",
  given: Record<string, unknown>[] | null,
  dryRun = false,
): Promise<void> {
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
    const types = PERSON_TYPES.includes(source.identityType as IdentityType) ? PERSON_TYPES : MACHINE_TYPES;
    const index = await listIdentitiesForCorrelation(tenantId, types);
    const taken = new Set([...links.values()].map((l) => l.identityId));

    // 3. Correlate.
    const ops: SourcedOp[] = [];
    const matched = new Map<string, string>();
    const pendings: { record: NormalizedSourceRecord; candidateIds: string[]; reason: string }[] = [];
    for (const record of valid) {
      const outcome = correlate(record, source.correlationRules, index, links.get(record.externalId)?.identityId ?? null, taken);
      if (outcome.kind === "linked" || outcome.kind === "matched") {
        if (outcome.kind === "matched") {
          taken.add(outcome.identityId);
          matched.set(record.externalId, outcome.identityId);
        }
        ops.push({ op: "update", ref: record.externalId, identityId: outcome.identityId, fields: record.fields });
      } else if (outcome.kind === "new") {
        ops.push({ op: "create", ref: record.externalId, identityType: source.identityType as IdentityType, fields: record.fields });
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
    const authority = { sourceId: source.id, priority: source.priority, authoritativeFields: source.authoritative ? source.authoritativeFields : [], sourceName: source.name, runId };
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
      const normalized = { ...p.record.fields, ...(p.record.managerExternalId ? { managerExternalId: p.record.managerExternalId } : {}) };
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
      const fields = { ...pending.normalized } as SourcedFields & { managerExternalId?: string };
      delete fields.managerExternalId;
      const authority = {
        sourceId: source.id,
        priority: source.priority,
        authoritativeFields: source.authoritative ? source.authoritativeFields : [],
        sourceName: source.name,
        runId: pending.runId ?? pendingId,
      };
      const op: SourcedOp =
        decision.action === "link"
          ? { op: "update", ref: pending.externalId, identityId: decision.identityId, fields }
          : { op: "create", ref: pending.externalId, identityType: source.identityType as IdentityType, fields };
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
    metadata: { pendingId, externalId: pending.externalId, decision: decision.action, identityId },
  });
  return { ...pending, status: claimedStatus, resolvedIdentityId: identityId };
}
