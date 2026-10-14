import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { evaluateRules, recordRuleRuns, ruleReferences, sameRuleDefinition, validateRule, type Rule, type RuleEvent, type RuleRunRecord } from "@/modules/operations/service";
import {
  APPLICATION_FIELDS,
  CLASSIFICATION_TRIGGERS,
  classificationContext,
  ENTITLEMENT_FIELDS,
  KNOWN_FIELDS,
  planEntitlementWrites,
  shapeClassificationRule,
  toRuntimeRule,
  workingDefinition,
  type ClassificationRuleInput,
  type ValidClassificationRule,
} from "./classificationRules";

/**
 * ACCESS-P0-33 part 2 — entitlement classification rules
 * (entitlement_classification_rules, migration 0170), run by Operations'
 * shared rule runtime (D12).
 *
 * Reads run as the caller (RLS) with an explicit tenant filter; writes use
 * the service role, filtered on the tenant resolved for the request, after
 * the route checked access.manage. Draft → simulated → publish requested →
 * published by someone else (four-eyes) → retired; an edit changes only the
 * working copy. When an enforced rule is published, it is applied once to
 * the existing entitlements in its scope as well.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITLEMENT_COLUMNS =
  "id, tenant_id, application_id, name, entitlement_type, privilege_level, data_classification, requestable, sox_relevant, owner_identity_id, external_ref, field_provenance, updated_at";
const APPLICATION_COLUMNS = "id, tenant_id, name, display_name, risk_level, data_classification, app_type, vendor";
const SIMULATION_LIMIT = 50_000;
const PAGE = 1000;
/** Existing entitlements an enforced rule is applied to when published. */
const APPLY_ON_PUBLISH_LIMIT = 5000;

export type ClassificationRule = {
  id: string;
  /** FOUNDATION-P0-34: its number in URLs (migration 0192). */
  ref: number | null;
  name: string;
  description: string | null;
  triggerType: string;
  applicationIds: string[];
  condition: string;
  effects: { type: string; params: Record<string, unknown> }[];
  mode: "report_only" | "enforce";
  priority: number;
  status: "draft" | "published" | "retired";
  publishedVersion: number;
  publishedAt: string | null;
  publishRequestedBy: string | null;
  lastSimulatedAt: string | null;
  unpublishedChanges: boolean;
  updatedAt: string;
};

function toRule(r: Row): ClassificationRule {
  return {
    id: r.id as string,
    ref: (r.ref as number | null) ?? null,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    triggerType: r.trigger_type as string,
    applicationIds: ((r.scope as { applications?: string[] }) ?? {}).applications ?? [],
    condition: r.condition as string,
    effects: (r.effects as ClassificationRule["effects"]) ?? [],
    mode: r.mode as ClassificationRule["mode"],
    priority: r.priority as number,
    status: r.status as ClassificationRule["status"],
    publishedVersion: r.published_version as number,
    publishedAt: (r.published_at as string | null) ?? null,
    publishRequestedBy: (r.publish_requested_by as string | null) ?? null,
    lastSimulatedAt: (r.last_simulated_at as string | null) ?? null,
    unpublishedChanges: !r.published || !sameRuleDefinition(r.published, workingDefinition(r)),
    updatedAt: r.updated_at as string,
  };
}

function toValid(r: Row): ValidClassificationRule {
  return {
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    trigger_type: r.trigger_type as ValidClassificationRule["trigger_type"],
    scope: (r.scope as ValidClassificationRule["scope"]) ?? {},
    condition: r.condition as string,
    effects: (r.effects as ValidClassificationRule["effects"]) ?? [],
    mode: r.mode as ValidClassificationRule["mode"],
    priority: r.priority as number,
  };
}

function writeError(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new ApiError(409, "CONFLICT", "A rule with this name already exists");
  if (error.code === "23514") throw new ApiError(409, "CONFLICT", error.message);
  throw new ApiError(500, "WRITE_FAILED", error.message);
}

/** Shape, then meaning: the condition reads only the entitlement's and its application's fields, and the scope names this organization's applications. */
async function validated(tenantId: string, input: ClassificationRuleInput, current?: ValidClassificationRule): Promise<ValidClassificationRule> {
  const shaped = shapeClassificationRule(input, current);
  if ("error" in shaped) throw new ApiError(400, "VALIDATION_FAILED", shaped.error);
  const problems = validateRule(
    { trigger: { type: shaped.trigger_type }, condition: shaped.condition, effects: shaped.effects, priority: shaped.priority },
    { identityFields: KNOWN_FIELDS, triggers: CLASSIFICATION_TRIGGERS },
  ).map((p) => `${p.field}: ${p.message}`);
  const known = {
    entitlement: new Set<string>(ENTITLEMENT_FIELDS),
    new: new Set<string>(ENTITLEMENT_FIELDS),
    old: new Set<string>(ENTITLEMENT_FIELDS),
    application: new Set<string>(APPLICATION_FIELDS),
  } as Record<string, Set<string>>;
  for (const ref of ruleReferences({ condition: shaped.condition, effects: shaped.effects })) {
    const [root, field] = ref.split(".");
    if (!known[root]) problems.push(`condition: "${ref}" — a classification rule reads entitlement.*, application.*, old.* and new.*`);
    else if (!known[root].has(field)) problems.push(`condition: unknown field "${ref}"`);
  }
  if (problems.length) throw new ApiError(400, "VALIDATION_FAILED", [...new Set(problems)].join("; "));
  if (shaped.scope.applications?.length) {
    const { data, error } = await supabaseServiceRole().from("applications").select("id").eq("tenant_id", tenantId).in("id", shaped.scope.applications);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    if ((data ?? []).length !== shaped.scope.applications.length) throw new ApiError(404, "NOT_FOUND", "applicationIds: an application is not in this organization");
  }
  return shaped;
}

async function loadRule(tenantId: string, ruleId: string): Promise<Row> {
  if (!UUID_RE.test(ruleId)) throw new ApiError(404, "NOT_FOUND", "No such rule");
  const { data, error } = await supabaseServiceRole().from("entitlement_classification_rules").select("*").eq("tenant_id", tenantId).eq("id", ruleId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such rule");
  return data;
}

// ---------------------------------------------------------------- reads

export async function listClassificationRules(tenantId: string): Promise<ClassificationRule[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("entitlement_classification_rules").select("*").eq("tenant_id", tenantId).order("status").order("priority").order("name").limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toRule);
}

export async function getClassificationRule(tenantId: string, ruleId: string): Promise<ClassificationRule | null> {
  if (!UUID_RE.test(ruleId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("entitlement_classification_rules").select("*").eq("tenant_id", tenantId).eq("id", ruleId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toRule(data) : null;
}

// ---------------------------------------------------------------- writes

export async function createClassificationRule(tenantId: string, actorId: string, input: ClassificationRuleInput): Promise<ClassificationRule> {
  const v = await validated(tenantId, { mode: "report_only", ...input });
  const { data, error } = await supabaseServiceRole()
    .from("entitlement_classification_rules")
    .insert({ tenant_id: tenantId, ...v, created_by: actorId, updated_by: actorId })
    .select("*")
    .single();
  if (error || !data) writeError(error ?? { message: "Could not create the rule" });
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.classification_rule_created",
    objectType: "classification_rule",
    objectId: data.id as string,
    outcome: "success",
    metadata: { name: v.name, trigger: v.trigger_type, mode: v.mode },
  });
  return toRule(data);
}

export async function updateClassificationRule(tenantId: string, actorId: string, ruleId: string, input: ClassificationRuleInput): Promise<ClassificationRule> {
  const row = await loadRule(tenantId, ruleId);
  if (row.status === "retired") throw new ApiError(409, "RULE_RETIRED", "A retired rule cannot change");
  const v = await validated(tenantId, input, toValid(row));
  const { data, error } = await supabaseServiceRole()
    .from("entitlement_classification_rules")
    .update({ ...v, publish_requested_by: null, publish_requested_at: null, last_simulated_at: null, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .eq("updated_at", row.updated_at as string)
    .select("*")
    .maybeSingle();
  if (error) writeError(error);
  if (!data) throw new ApiError(409, "CONFLICT", "The rule changed meanwhile; reload");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.classification_rule_updated",
    objectType: "classification_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { fields: Object.keys(input) },
  });
  return toRule(data);
}

export type ClassificationSimulation = {
  evaluated: number;
  truncated: boolean;
  matched: number;
  wouldChange: number;
  changes: { entitlementId: string; name: string; field: string; before: unknown; after: unknown }[];
  skipped: { entitlementId: string; name: string; field: string; reason: string }[];
  errors: string[];
};

/** Pages through entitlements in scope (keyset on id), with their applications. */
async function* entitlementPages(tenantId: string, applicationIds: string[] | undefined, limit: number) {
  const supabase = supabaseServiceRole();
  let after: string | null = null;
  let seen = 0;
  const apps = new Map<string, Row>();
  while (seen < limit) {
    let query = supabase.from("entitlements").select(ENTITLEMENT_COLUMNS).eq("tenant_id", tenantId);
    if (applicationIds?.length) query = query.in("application_id", applicationIds);
    if (after) query = query.gt("id", after);
    const { data, error } = await query.order("id").limit(Math.min(PAGE, limit - seen));
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.tenant_id === tenantId);
    if (!rows.length) return;
    after = rows[rows.length - 1].id as string;
    seen += rows.length;
    const missing = [...new Set(rows.map((r) => r.application_id as string))].filter((id) => !apps.has(id));
    if (missing.length) {
      const { data: appRows, error: appError } = await supabase.from("applications").select(APPLICATION_COLUMNS).eq("tenant_id", tenantId).in("id", missing);
      if (appError) throw new ApiError(500, "QUERY_FAILED", appError.message);
      for (const a of (appRows ?? []) as Row[]) apps.set(a.id as string, a);
    }
    yield { rows, apps, done: rows.length < PAGE };
    if (rows.length < PAGE) return;
  }
}

/** Runs the working copy as if enforced over the entitlements in scope; changes nothing but the "simulated" time. */
export async function simulateClassificationRule(tenantId: string, actorId: string, ruleId: string): Promise<ClassificationSimulation> {
  const row = await loadRule(tenantId, ruleId);
  if (row.status === "retired") throw new ApiError(409, "RULE_RETIRED", "A retired rule cannot be simulated");
  const rule = { ...toRuntimeRule(row, "working")!, mode: "enforce" as const };
  const result: ClassificationSimulation = { evaluated: 0, truncated: false, matched: 0, wouldChange: 0, changes: [], skipped: [], errors: [] };
  const now = new Date().toISOString();
  for await (const page of entitlementPages(tenantId, rule.scope?.applications, SIMULATION_LIMIT)) {
    for (const e of page.rows) {
      result.evaluated++;
      const { log } = evaluateRules(
        [rule],
        { type: rule.trigger.type },
        { id: e.id as string, application: e.application_id as string },
        classificationContext(e, page.apps.get(e.application_id as string) ?? null, null),
        { includeUnpublished: true },
      );
      const entry = log[0];
      if (!entry || entry.outcome === "not_matched" || entry.outcome === "out_of_scope") continue;
      if (entry.outcome === "error") {
        if (result.errors.length < 20) result.errors.push(`${e.name}: ${entry.error}`);
        continue;
      }
      result.matched++;
      const plan = planEntitlementWrites(e, [{ ruleId: rule.id, ruleVersion: rule.version, effects: entry.effects }], now);
      if (plan.written.length) result.wouldChange++;
      for (const w of plan.written) if (result.changes.length < 50) result.changes.push({ entitlementId: e.id as string, name: e.name as string, field: w.field, before: w.before, after: w.after });
      for (const s of plan.skipped) if (result.skipped.length < 50) result.skipped.push({ entitlementId: e.id as string, name: e.name as string, field: s.field, reason: s.reason });
    }
  }
  result.truncated = result.evaluated >= SIMULATION_LIMIT;
  await supabaseServiceRole()
    .from("entitlement_classification_rules")
    .update({ last_simulated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .eq("updated_at", row.updated_at as string);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.classification_rule_simulated",
    objectType: "classification_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { evaluated: result.evaluated, matched: result.matched, wouldChange: result.wouldChange },
  });
  return result;
}

export async function requestClassificationRulePublish(tenantId: string, actorId: string, ruleId: string): Promise<ClassificationRule> {
  const row = await loadRule(tenantId, ruleId);
  if (row.status === "retired") throw new ApiError(409, "RULE_RETIRED", "A retired rule cannot be published");
  if (!row.last_simulated_at) throw new ApiError(409, "NOT_SIMULATED", "Simulate the rule before asking to publish it");
  if (row.publish_requested_by) throw new ApiError(409, "ALREADY_REQUESTED", "Publishing is already waiting for approval");
  if (row.published && sameRuleDefinition(row.published, workingDefinition(row))) throw new ApiError(409, "NOTHING_TO_PUBLISH", "This version is already published");
  const { data, error } = await supabaseServiceRole()
    .from("entitlement_classification_rules")
    .update({ publish_requested_by: actorId, publish_requested_at: new Date().toISOString(), published_by: null })
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .eq("updated_at", row.updated_at as string)
    .is("publish_requested_by", null)
    .select("*")
    .maybeSingle();
  if (error) writeError(error);
  if (!data) throw new ApiError(409, "CONFLICT", "The rule changed meanwhile; reload");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.classification_rule_publish_requested",
    objectType: "classification_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { mode: row.mode },
  });
  return toRule(data);
}

/** Publishes the requested working copy (four-eyes). An enforced rule is then applied to the existing entitlements in its scope. */
export async function approveClassificationRulePublish(tenantId: string, actorId: string, ruleId: string): Promise<ClassificationRule & { appliedTo: number }> {
  const row = await loadRule(tenantId, ruleId);
  if (!row.publish_requested_by) throw new ApiError(409, "NOT_REQUESTED", "Nobody has asked to publish this rule");
  if (row.publish_requested_by === actorId) throw new ApiError(403, "FOUR_EYES", "Someone other than the person who asked approves publishing");
  const definition = workingDefinition(row);
  const version = (row.published_version as number) + 1;
  const admin = supabaseServiceRole();
  const now = new Date().toISOString();
  const { error: versionError } = await admin
    .from("entitlement_classification_rule_versions")
    .insert({ tenant_id: tenantId, rule_id: ruleId, version, definition, requested_by: row.publish_requested_by, approved_by: actorId, published_at: now });
  if (versionError) {
    if (versionError.code === "23505") throw new ApiError(409, "CONFLICT", "This version was just published; reload");
    writeError(versionError);
  }
  const { data, error } = await admin
    .from("entitlement_classification_rules")
    // The request is fulfilled; who asked stays on the version row.
    .update({ status: "published", published: definition, published_version: version, published_by: actorId, published_at: now, publish_requested_by: null, publish_requested_at: null })
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .eq("updated_at", row.updated_at as string)
    .select("*")
    .maybeSingle();
  if (error) writeError(error);
  if (!data) throw new ApiError(409, "CONFLICT", "The rule changed meanwhile; reload");

  let appliedTo = 0;
  if (definition.mode === "enforce") {
    const rule = toRuntimeRule(data, "published")!;
    for await (const page of entitlementPages(tenantId, rule.scope?.applications, APPLY_ON_PUBLISH_LIMIT)) {
      const outcome = await classifyEntitlements(
        tenantId,
        page.rows.map((e) => ({ entitlementId: e.id as string, trigger: rule.trigger.type })),
        { rules: [data], correlationId: `publish:${ruleId}:${version}`, rows: page.rows, apps: page.apps },
      );
      appliedTo += outcome.changed;
    }
  }
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.classification_rule_published",
    objectType: "classification_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { version, mode: definition.mode, requestedBy: row.publish_requested_by, appliedTo },
  });
  return { ...toRule(data), appliedTo };
}

export async function retireClassificationRule(tenantId: string, actorId: string, ruleId: string): Promise<ClassificationRule> {
  const row = await loadRule(tenantId, ruleId);
  if (row.status === "retired") return toRule(row);
  const { data, error } = await supabaseServiceRole()
    .from("entitlement_classification_rules")
    .update({ status: "retired", publish_requested_by: null, publish_requested_at: null, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .select("*")
    .single();
  if (error || !data) writeError(error ?? { message: "Could not retire the rule" });
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.classification_rule_retired",
    objectType: "classification_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { version: row.published_version },
  });
  return toRule(data);
}

// ---------------------------------------------------------------- applying rules

/** The organization's published classification rules, read once per batch. */
export async function loadLiveClassificationRules(tenantId: string): Promise<Row[]> {
  const { data, error } = await supabaseServiceRole().from("entitlement_classification_rules").select("*").eq("tenant_id", tenantId).eq("status", "published");
  if (error) throw new Error(`loading classification rules: ${error.message}`);
  return ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId);
}

/**
 * Runs the published classification rules for a batch of entitlements that
 * were imported or changed, writes what enforced rules set (with rule
 * provenance, never over a person's value), and logs every outcome. A system
 * action after the change that triggered it. Never throws: a failure is
 * returned and logged and never undoes the import.
 */
export async function classifyEntitlements(
  tenantId: string,
  items: { entitlementId: string; trigger: "entitlement.imported" | "entitlement.changed" | string; changed?: string[]; before?: Row | null }[],
  opts: { rules?: Row[]; correlationId?: string | null; rows?: Row[]; apps?: Map<string, Row> } = {},
): Promise<{ changed: number; error?: string }> {
  if (!items.length) return { changed: 0 };
  try {
    const rules = (opts.rules ?? (await loadLiveClassificationRules(tenantId))).map((r) => toRuntimeRule(r, "published")).filter((r): r is Rule => !!r);
    if (!rules.length) return { changed: 0 };
    const admin = supabaseServiceRole();
    const rows = new Map<string, Row>((opts.rows ?? []).map((r) => [r.id as string, r]));
    const missing = items.map((i) => i.entitlementId).filter((id) => !rows.has(id));
    for (let i = 0; i < missing.length; i += 200) {
      const { data, error } = await admin
        .from("entitlements")
        .select(ENTITLEMENT_COLUMNS)
        .eq("tenant_id", tenantId)
        .in("id", missing.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as unknown as Row[]) if (r.tenant_id === tenantId) rows.set(r.id as string, r);
    }
    const apps = opts.apps ?? new Map<string, Row>();
    const appIds = [...new Set([...rows.values()].map((r) => r.application_id as string))].filter((id) => !apps.has(id));
    if (appIds.length) {
      const { data, error } = await admin.from("applications").select(APPLICATION_COLUMNS).eq("tenant_id", tenantId).in("id", appIds);
      if (error) throw new Error(error.message);
      for (const a of (data ?? []) as Row[]) apps.set(a.id as string, a);
    }

    const now = new Date().toISOString();
    const records: RuleRunRecord[] = [];
    let changed = 0;
    for (const item of items) {
      const e = rows.get(item.entitlementId);
      if (!e) continue;
      const event: RuleEvent = { type: item.trigger, changedAttributes: item.changed ?? [] };
      const { log } = evaluateRules(
        rules,
        event,
        { id: e.id as string, application: e.application_id as string },
        classificationContext(e, apps.get(e.application_id as string) ?? null, item.before ?? null),
      );
      if (!log.length) continue;
      const applied = log.filter((l) => l.outcome === "applied").map((l) => ({ ruleId: l.ruleId, ruleVersion: l.ruleVersion, effects: l.effects }));
      const plan = planEntitlementWrites(e, applied, now);
      let writeError: string | null = null;
      if (plan.written.length) {
        const { data, error } = await admin
          .from("entitlements")
          .update({ ...plan.set, field_provenance: plan.provenance, updated_at: now })
          .eq("tenant_id", tenantId)
          .eq("id", e.id as string)
          .eq("updated_at", e.updated_at as string)
          .select("id");
        if (error) writeError = error.message;
        else if (!data?.length) writeError = "the entitlement changed meanwhile; the rules run again on that change";
        else changed++;
      }
      for (const entry of log) {
        if (entry.outcome !== "applied") {
          records.push(entry);
          continue;
        }
        if (writeError) {
          records.push({ ...entry, outcome: "error", detail: writeError });
          continue;
        }
        const mine = plan.written.filter((w) => w.ruleId === entry.ruleId);
        const skips = plan.skipped.filter((s) => s.ruleId === entry.ruleId);
        if (!mine.length && skips.length) records.push({ ...entry, outcome: "skipped", detail: skips.map((s) => `${s.field}: ${s.reason}`).join("; ") });
        else records.push({ ...entry, detail: skips.length ? `Skipped ${skips.map((s) => `${s.field}: ${s.reason}`).join("; ")}` : undefined });
      }
    }
    for (let i = 0; i < records.length; i += 500) await recordRuleRuns(tenantId, "entitlement_classification_rules", "entitlement", records.slice(i, i + 500), opts.correlationId);
    if (changed) {
      await writeAudit({
        tenantId,
        actorId: null,
        actorType: "system",
        action: "access.entitlements_classified",
        objectType: "application",
        objectId: [...rows.values()][0]?.application_id as string,
        outcome: "success",
        // The audit log's correlation id is a uuid; a run label (publish:<rule>:<version>) goes in the metadata.
        correlationId: opts.correlationId && UUID_RE.test(opts.correlationId) ? opts.correlationId : undefined,
        metadata: { changed, evaluated: items.length, run: opts.correlationId ?? null },
      });
    }
    return { changed };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "classification rules could not run";
    console.error(`classification rules (${tenantId}): ${message}`);
    return { changed: 0, error: message };
  }
}

export async function listClassificationRuns(tenantId: string, ruleId: string, limit = 20) {
  const { listRuleRuns } = await import("@/modules/operations/service");
  return listRuleRuns(tenantId, { ruleId, limit });
}
