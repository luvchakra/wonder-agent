import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { IdentityAttributeDefinition, IdentityType } from "@/lib/shared/types/agent-identity";
import { evaluateRules, recordRuleRuns, validateRule, type RuleEvent, type RuleRunRecord } from "@/modules/operations/service";
import {
  ATTRIBUTE_RULE_TRIGGERS,
  knownFields,
  planAttributeWrites,
  sameDefinition,
  ruleContext,
  settableFor,
  shapeRuleInput,
  toRuntimeRule,
  workingDefinition,
  type RuleInput,
  type ValidRuleInput,
} from "./attributeRules";

/**
 * IDENTITY-P0-21 — the organization's attribute rules (lifecycle_rules,
 * migration 0166), run by Operations' shared rule runtime (D12).
 *
 * Reads run as the caller (RLS) with an explicit tenant filter. Writes use
 * the service role because members cannot write rules directly; every
 * statement filters on the tenant resolved for the request, and the
 * caller's permission (identity.manage) is checked by the route.
 *
 * Draft → simulated → publish requested → published by someone else
 * (four-eyes, D-3) → retired. Editing a published rule changes only its
 * working copy: the published copy keeps running until the edit is
 * simulated and published.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY_COLUMNS =
  "id, tenant_id, identity_type, subtype, display_name, username, email, status, lifecycle_state, department, title, business_unit, location, employment_type, organization, purpose, start_date, end_date, privileged, external, source_system, manager_identity_id, attributes, field_provenance, updated_at";
/** A simulation over more identities than this reports the first ones only (by id). */
const SIMULATION_LIMIT = 50_000;
const SIMULATION_PAGE = 1000;

export type IdentityRule = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerAttribute: string | null;
  triggerSource: string | null;
  scope: { identityTypes?: string[]; sources?: string[] };
  condition: string;
  effects: { type: string; params: Record<string, unknown> }[];
  mode: "report_only" | "enforce";
  priority: number;
  status: "draft" | "published" | "retired";
  publishedVersion: number;
  publishedAt: string | null;
  publishRequestedBy: string | null;
  publishRequestedAt: string | null;
  lastSimulatedAt: string | null;
  /** The working copy differs from what runs. */
  unpublishedChanges: boolean;
  updatedAt: string;
};

function toRule(r: Row): IdentityRule {
  const working = workingDefinition(r);
  return {
    id: r.id as string,
    kind: r.kind as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    triggerType: r.trigger_type as string,
    triggerAttribute: (r.trigger_attribute as string | null) ?? null,
    triggerSource: (r.trigger_source as string | null) ?? null,
    scope: (r.scope as IdentityRule["scope"]) ?? {},
    condition: r.condition as string,
    effects: (r.effects as IdentityRule["effects"]) ?? [],
    mode: r.mode as IdentityRule["mode"],
    priority: r.priority as number,
    status: r.status as IdentityRule["status"],
    publishedVersion: r.published_version as number,
    publishedAt: (r.published_at as string | null) ?? null,
    publishRequestedBy: (r.publish_requested_by as string | null) ?? null,
    publishRequestedAt: (r.publish_requested_at as string | null) ?? null,
    lastSimulatedAt: (r.last_simulated_at as string | null) ?? null,
    unpublishedChanges: !r.published || !sameDefinition(r.published, working),
    updatedAt: r.updated_at as string,
  };
}

function toValid(r: Row): ValidRuleInput {
  return {
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    trigger_type: r.trigger_type as ValidRuleInput["trigger_type"],
    trigger_attribute: (r.trigger_attribute as string | null) ?? null,
    trigger_source: (r.trigger_source as string | null) ?? null,
    scope: (r.scope as ValidRuleInput["scope"]) ?? {},
    condition: r.condition as string,
    effects: (r.effects as ValidRuleInput["effects"]) ?? [],
    mode: r.mode as ValidRuleInput["mode"],
    priority: r.priority as number,
  };
}

async function definitionsOf(tenantId: string): Promise<IdentityAttributeDefinition[]> {
  const { data, error } = await supabaseServiceRole()
    .from("identity_attribute_definitions")
    .select("name, display_name, identity_type, data_type, required, allowed_values, validation_regex, unique_value, active")
    .eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => ({
    name: r.name as string,
    displayName: r.display_name as string,
    identityType: (r.identity_type as IdentityType | null) ?? null,
    dataType: r.data_type,
    required: Boolean(r.required),
    allowedValues: (r.allowed_values as string[]) ?? [],
    validationRegex: (r.validation_regex as string | null) ?? null,
    uniqueValue: Boolean(r.unique_value),
    active: Boolean(r.active),
  })) as unknown as IdentityAttributeDefinition[];
}

/** Shape, then meaning: the condition and values name only known fields, and only settable attributes are set. */
async function validated(tenantId: string, input: RuleInput, current?: ValidRuleInput): Promise<ValidRuleInput> {
  const shaped = shapeRuleInput(input, current);
  if ("error" in shaped) throw new ApiError(400, "VALIDATION_FAILED", shaped.error);
  const definitions = await definitionsOf(tenantId);
  const problems = validateRule(
    { trigger: { type: shaped.trigger_type }, condition: shaped.condition, effects: shaped.effects, priority: shaped.priority },
    { identityFields: [...knownFields(definitions), ...settableFor(definitions)], triggers: ATTRIBUTE_RULE_TRIGGERS },
  );
  const settable = new Set(settableFor(definitions).map((f) => f.toLowerCase()));
  shaped.effects.forEach((e, i) => {
    if (!settable.has(String(e.params.attribute).toLowerCase())) problems.push({ field: `effects.${i}.attribute`, message: `"${e.params.attribute}" cannot be set by a rule` });
  });
  if (problems.length) throw new ApiError(400, "VALIDATION_FAILED", problems.map((p) => `${p.field}: ${p.message}`).join("; "));
  return shaped;
}

async function loadRule(tenantId: string, ruleId: string): Promise<Row> {
  if (!UUID_RE.test(ruleId)) throw new ApiError(404, "NOT_FOUND", "No such rule");
  const { data, error } = await supabaseServiceRole().from("lifecycle_rules").select("*").eq("tenant_id", tenantId).eq("id", ruleId).eq("kind", "attribute").maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such rule");
  return data;
}

function writeError(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new ApiError(409, "CONFLICT", "A rule with this name already exists");
  if (error.code === "23514") throw new ApiError(409, "CONFLICT", error.message);
  throw new ApiError(500, "WRITE_FAILED", error.message);
}

// ---------------------------------------------------------------- reads

export async function listIdentityRules(tenantId: string): Promise<IdentityRule[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("lifecycle_rules").select("*").eq("tenant_id", tenantId).eq("kind", "attribute").order("status").order("priority").order("name").limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toRule);
}

export async function getIdentityRule(
  tenantId: string,
  ruleId: string,
): Promise<(IdentityRule & { versions: { version: number; publishedAt: string; requestedBy: string | null; approvedBy: string | null }[] }) | null> {
  if (!UUID_RE.test(ruleId)) return null;
  const supabase = await supabaseServer();
  const [{ data, error }, versions] = await Promise.all([
    supabase.from("lifecycle_rules").select("*").eq("tenant_id", tenantId).eq("id", ruleId).eq("kind", "attribute").maybeSingle(),
    supabase
      .from("lifecycle_rule_versions")
      .select("version, published_at, requested_by, approved_by")
      .eq("tenant_id", tenantId)
      .eq("rule_id", ruleId)
      .order("version", { ascending: false })
      .limit(50),
  ]);
  if (error || versions.error) throw new ApiError(500, "QUERY_FAILED", (error ?? versions.error)!.message);
  if (!data) return null;
  return {
    ...toRule(data),
    versions: (versions.data ?? []).map((v) => ({
      version: v.version as number,
      publishedAt: v.published_at as string,
      requestedBy: (v.requested_by as string | null) ?? null,
      approvedBy: (v.approved_by as string | null) ?? null,
    })),
  };
}

// ---------------------------------------------------------------- writes

export async function createIdentityRule(tenantId: string, actorId: string, input: RuleInput): Promise<IdentityRule> {
  // A new rule starts in report-only mode (§5.2.1) unless asked otherwise; enforcing still needs publishing by someone else.
  const v = await validated(tenantId, { mode: "report_only", ...input });
  const { data, error } = await supabaseServiceRole()
    .from("lifecycle_rules")
    .insert({ tenant_id: tenantId, kind: "attribute", ...v, created_by: actorId, updated_by: actorId })
    .select("*")
    .single();
  if (error || !data) writeError(error ?? { message: "Could not create the rule" });
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.rule_created",
    objectType: "lifecycle_rule",
    objectId: data.id as string,
    outcome: "success",
    metadata: { name: v.name, trigger: v.trigger_type, mode: v.mode },
  });
  return toRule(data);
}

/** Edits the working copy. Any pending publish request is withdrawn and the rule must be simulated again. */
export async function updateIdentityRule(tenantId: string, actorId: string, ruleId: string, input: RuleInput): Promise<IdentityRule> {
  const row = await loadRule(tenantId, ruleId);
  if (row.status === "retired") throw new ApiError(409, "RULE_RETIRED", "A retired rule cannot change");
  const v = await validated(tenantId, input, toValid(row));
  const { data, error } = await supabaseServiceRole()
    .from("lifecycle_rules")
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
    action: "identity.rule_updated",
    objectType: "lifecycle_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { fields: Object.keys(input) },
  });
  return toRule(data);
}

export type RuleSimulation = {
  evaluated: number;
  /** More identities are in scope than were simulated. */
  truncated: boolean;
  matched: number;
  wouldChange: number;
  share: number;
  changes: { identityId: string; displayName: string; attribute: string; before: unknown; after: unknown }[];
  skipped: { identityId: string; displayName: string; attribute: string; reason: string }[];
  errors: string[];
};

/**
 * Runs the working copy, as if enforced, over the identities in its scope
 * and lists who would change and how (and what a source's value would keep
 * from changing). Changes nothing but the rule's "simulated" time.
 */
export async function simulateIdentityRule(tenantId: string, actorId: string, ruleId: string): Promise<RuleSimulation> {
  const row = await loadRule(tenantId, ruleId);
  if (row.status === "retired") throw new ApiError(409, "RULE_RETIRED", "A retired rule cannot be simulated");
  const rule = toRuntimeRule(row, "working")!;
  const asEnforced = { ...rule, mode: "enforce" as const };
  const definitions = await definitionsOf(tenantId);
  const supabase = await supabaseServer();
  const event: RuleEvent = { type: rule.trigger.type, changedAttributes: rule.trigger.attribute ? [rule.trigger.attribute] : [], source: rule.trigger.source };
  const result: RuleSimulation = { evaluated: 0, truncated: false, matched: 0, wouldChange: 0, share: 0, changes: [], skipped: [], errors: [] };
  const now = new Date().toISOString();

  // Every identity in scope, a page at a time (keyset on id), up to SIMULATION_LIMIT.
  let after: string | null = null;
  while (result.evaluated < SIMULATION_LIMIT) {
    let query = supabase.from("identities").select(IDENTITY_COLUMNS).eq("tenant_id", tenantId);
    if (rule.scope?.identityTypes?.length) query = query.in("identity_type", rule.scope.identityTypes);
    if (after) query = query.gt("id", after);
    const { data, error } = await query.order("id").limit(Math.min(SIMULATION_PAGE, SIMULATION_LIMIT - result.evaluated));
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const identities = (data ?? []) as unknown as Row[];
    if (!identities.length) break;
    after = identities[identities.length - 1].id as string;
    const managers = await rowsById(
      tenantId,
      identities.map((i) => i.manager_identity_id as string | null),
    );
    for (const identity of identities) {
      result.evaluated++;
      const name = identity.display_name as string;
      const { log } = evaluateRules([asEnforced], event, subjectOf(identity), ruleContext(identity, managers.get(identity.manager_identity_id as string) ?? null, null), {
        includeUnpublished: true,
      });
      const entry = log[0];
      if (!entry) continue;
      if (entry.outcome === "error") {
        if (result.errors.length < 20) result.errors.push(`${name}: ${entry.error}`);
        continue;
      }
      if (entry.outcome !== "applied") continue;
      result.matched++;
      const plan = planAttributeWrites(identity, [{ ruleId: rule.id, ruleVersion: rule.version, effects: entry.effects }], definitions, now);
      if (plan.written.length) result.wouldChange++;
      for (const w of plan.written)
        if (result.changes.length < 50) result.changes.push({ identityId: identity.id as string, displayName: name, attribute: w.attribute, before: w.before, after: w.after });
      for (const s of plan.skipped) if (result.skipped.length < 50) result.skipped.push({ identityId: identity.id as string, displayName: name, attribute: s.attribute, reason: s.reason });
    }
    if (identities.length < SIMULATION_PAGE) break;
  }
  result.truncated = result.evaluated >= SIMULATION_LIMIT;
  result.share = result.evaluated ? Math.round((result.wouldChange / result.evaluated) * 1000) / 1000 : 0;

  // The time is recorded only if the rule has not changed since it was read: a simulation is of one definition.
  await supabaseServiceRole()
    .from("lifecycle_rules")
    .update({ last_simulated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .eq("updated_at", row.updated_at as string);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.rule_simulated",
    objectType: "lifecycle_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { evaluated: result.evaluated, matched: result.matched, wouldChange: result.wouldChange, truncated: result.truncated },
  });
  return result;
}

/** Asks for the working copy to be published. It must have been simulated since its last edit. */
export async function requestIdentityRulePublish(tenantId: string, actorId: string, ruleId: string): Promise<IdentityRule> {
  const row = await loadRule(tenantId, ruleId);
  if (row.status === "retired") throw new ApiError(409, "RULE_RETIRED", "A retired rule cannot be published");
  if (!row.last_simulated_at) throw new ApiError(409, "NOT_SIMULATED", "Simulate the rule before asking to publish it");
  if (row.publish_requested_by) throw new ApiError(409, "ALREADY_REQUESTED", "Publishing is already waiting for approval");
  if (row.published && sameDefinition(row.published, workingDefinition(row))) throw new ApiError(409, "NOTHING_TO_PUBLISH", "This version is already published");
  const { data, error } = await supabaseServiceRole()
    .from("lifecycle_rules")
    // published_by now means "approved the request": cleared until someone approves this one (history: lifecycle_rule_versions).
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
    action: "identity.rule_publish_requested",
    objectType: "lifecycle_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { mode: row.mode },
  });
  return toRule(data);
}

/** Publishes the requested working copy as the next version. Someone other than the requester (four-eyes; the database refuses it too). */
export async function approveIdentityRulePublish(tenantId: string, actorId: string, ruleId: string): Promise<IdentityRule> {
  const row = await loadRule(tenantId, ruleId);
  if (!row.publish_requested_by) throw new ApiError(409, "NOT_REQUESTED", "Nobody has asked to publish this rule");
  if (row.publish_requested_by === actorId) throw new ApiError(403, "FOUR_EYES", "Someone other than the person who asked approves publishing");
  const definition = workingDefinition(row);
  const version = (row.published_version as number) + 1;
  const admin = supabaseServiceRole();
  const now = new Date().toISOString();
  const { error: versionError } = await admin
    .from("lifecycle_rule_versions")
    .insert({ tenant_id: tenantId, rule_id: ruleId, version, definition, requested_by: row.publish_requested_by, approved_by: actorId, published_at: now });
  if (versionError) {
    if (versionError.code === "23505") throw new ApiError(409, "CONFLICT", "This version was just published; reload");
    writeError(versionError);
  }
  const { data, error } = await admin
    .from("lifecycle_rules")
    // The request is fulfilled; who asked stays on the version row.
    .update({ status: "published", published: definition, published_version: version, published_by: actorId, published_at: now, publish_requested_by: null, publish_requested_at: null })
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
    action: "identity.rule_published",
    objectType: "lifecycle_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { version, mode: definition.mode, requestedBy: row.publish_requested_by },
  });
  return toRule(data);
}

export async function retireIdentityRule(tenantId: string, actorId: string, ruleId: string): Promise<IdentityRule> {
  const row = await loadRule(tenantId, ruleId);
  if (row.status === "retired") return toRule(row);
  const { data, error } = await supabaseServiceRole()
    .from("lifecycle_rules")
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
    action: "identity.rule_retired",
    objectType: "lifecycle_rule",
    objectId: ruleId,
    outcome: "success",
    metadata: { version: row.published_version },
  });
  return toRule(data);
}

// ---------------------------------------------------------------- applying rules

function subjectOf(identity: Row) {
  return { id: identity.id as string, identityType: identity.identity_type as string, source: (identity.source_system as string | null) ?? null };
}

async function rowsById(tenantId: string, ids: (string | null | undefined)[]): Promise<Map<string, Row>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, Row>();
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabaseServiceRole()
      .from("identities")
      .select(IDENTITY_COLUMNS)
      .eq("tenant_id", tenantId)
      .in("id", unique.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as Row[]) if (r.tenant_id === tenantId) out.set(r.id as string, r);
  }
  return out;
}

/** The organization's published attribute rules, read once per batch. */
export async function loadLiveIdentityRules(tenantId: string): Promise<Row[]> {
  const { data, error } = await supabaseServiceRole().from("lifecycle_rules").select("*").eq("tenant_id", tenantId).eq("kind", "attribute").eq("status", "published");
  if (error) throw new Error(`loading identity rules: ${error.message}`);
  return ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId);
}

export type AppliedRules = { changed: boolean; error?: string };

/**
 * Runs the published attribute rules for one event on one identity, writes
 * what enforced rules set (with rule provenance), and records every rule's
 * outcome in the run log. A system action: called after the change that
 * triggered it, never in place of its authorization. Never throws: a
 * failure is returned and logged, and never undoes the change that
 * triggered it.
 */
export async function applyIdentityRules(
  tenantId: string,
  identityId: string,
  event: RuleEvent,
  opts: { before?: Row | null; rules?: Row[]; definitions?: IdentityAttributeDefinition[]; correlationId?: string | null } = {},
): Promise<AppliedRules> {
  let rules: ReturnType<typeof toRuntimeRule>[] = [];
  try {
    const rows = opts.rules ?? (await loadLiveIdentityRules(tenantId));
    rules = rows.map((r) => toRuntimeRule(r, "published")).filter((r) => r && r.trigger.type === event.type);
    if (!rules.length) return { changed: false };

    const identities = await rowsById(tenantId, [identityId]);
    const identity = identities.get(identityId);
    if (!identity) return { changed: false, error: "identity not found in this organization" };
    const managers = await rowsById(tenantId, [identity.manager_identity_id as string | null]);
    const definitions = opts.definitions ?? (await definitionsOf(tenantId));
    const now = new Date().toISOString();

    const { log } = evaluateRules(
      rules as NonNullable<(typeof rules)[number]>[],
      event,
      subjectOf(identity),
      ruleContext(identity, managers.get(identity.manager_identity_id as string) ?? null, opts.before ?? null),
    );
    const applied = log.filter((l) => l.outcome === "applied").map((l) => ({ ruleId: l.ruleId, ruleVersion: l.ruleVersion, effects: l.effects }));
    const plan = planAttributeWrites(identity, applied, definitions, now);

    // A unique attribute a rule would give a value someone else holds is skipped, not forced.
    const current = (identity.attributes as Row) ?? {};
    for (const def of definitions.filter((d) => d.uniqueValue && d.active)) {
      const value = plan.attributes?.[def.name];
      if (!plan.attributes || value === undefined || value === current[def.name]) continue;
      const { data, error } = await supabaseServiceRole().from("identities").select("id").eq("tenant_id", tenantId).eq(`attributes->>${def.name}`, String(value)).neq("id", identityId).limit(1);
      if (error) throw new Error(error.message);
      if (!data?.length) continue;
      if (current[def.name] === undefined) delete plan.attributes[def.name];
      else plan.attributes[def.name] = current[def.name];
      for (const w of plan.written.filter((x) => x.attribute === def.name)) plan.skipped.push({ ruleId: w.ruleId, attribute: def.name, reason: "another identity already has this value" });
      plan.written = plan.written.filter((x) => x.attribute !== def.name);
    }

    let writeError: string | null = null;
    if (plan.written.length) {
      const update: Row = { ...plan.columns, field_provenance: plan.provenance, updated_at: now };
      if (plan.attributes) update.attributes = plan.attributes;
      const { data, error } = await supabaseServiceRole()
        .from("identities")
        .update(update)
        .eq("tenant_id", tenantId)
        .eq("id", identityId)
        .eq("updated_at", identity.updated_at as string)
        .select("id");
      if (error) writeError = error.message;
      else if (!data?.length) writeError = "the identity changed meanwhile; the rules run again on that change";
    }

    const records: RuleRunRecord[] = log.map((entry) => {
      if (entry.outcome !== "applied") return entry;
      if (writeError) return { ...entry, outcome: "error" as const, detail: writeError };
      const mine = plan.written.filter((w) => w.ruleId === entry.ruleId);
      const skips = plan.skipped.filter((s) => s.ruleId === entry.ruleId);
      if (!mine.length && skips.length) return { ...entry, outcome: "skipped" as const, detail: skips.map((s) => `${s.attribute}: ${s.reason}`).join("; ") };
      return { ...entry, detail: skips.length ? `Skipped ${skips.map((s) => `${s.attribute}: ${s.reason}`).join("; ")}` : undefined };
    });
    await recordRuleRuns(tenantId, "lifecycle_rules", "identity", records, opts.correlationId);

    if (plan.written.length && !writeError) {
      await writeAudit({
        tenantId,
        actorId: null,
        actorType: "system",
        action: "identity.rules_applied",
        objectType: "identity",
        objectId: identityId,
        outcome: "success",
        correlationId: opts.correlationId ?? undefined,
        // Names only, never values (#10, §17.7).
        metadata: { trigger: event.type, rules: [...new Set(plan.written.map((w) => w.ruleId))], attributes: plan.written.map((w) => w.attribute) },
      });
    }
    return writeError ? { changed: false, error: writeError } : { changed: plan.written.length > 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "rules could not run";
    console.error(`identity rules (${tenantId}, ${identityId}): ${message}`);
    // Best effort: the failure goes into the run log of each rule that should have run.
    const failed = rules
      .filter(Boolean)
      .map((r) => ({ ruleId: r!.id, ruleVersion: r!.version, subjectId: identityId, trigger: event.type, mode: r!.mode, outcome: "error" as const, effects: [], detail: message }));
    await recordRuleRuns(tenantId, "lifecycle_rules", "identity", failed, opts.correlationId).catch(() => undefined);
    return { changed: false, error: message };
  }
}
