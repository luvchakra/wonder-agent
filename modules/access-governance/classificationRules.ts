import type { EffectValue, PlannedEffect, Rule, RuleContext, RuleEffect, RuleMode, RuleStatus } from "@/modules/operations/service";

/**
 * ACCESS-P0-33 part 2 — entitlement classification rules (design §5.4), pure
 * (#9). A rule triggers when an entitlement is imported or changes, matches
 * on what is known about it and its application, and sets its privilege
 * level, data classification, type, requestable or SOX-relevant flag. It
 * never overrides a value a person set (field_provenance `by: person`).
 * Evaluated by Operations' shared rule runtime (D12).
 *
 *   entitlement.name matches "-admin$"            → privilegeLevel = admin, requestable = false
 *   application.name = "AWS" and entitlement.name = "AdministratorAccess" → soxRelevant = true
 */

export const CLASSIFICATION_TRIGGERS = ["entitlement.imported", "entitlement.changed"] as const;
export type ClassificationTrigger = (typeof CLASSIFICATION_TRIGGERS)[number];

/** What a rule may set, by field, with its column and how a value is checked. */
export const SETTABLE: Record<string, { column: string; check: (v: unknown) => boolean; hint: string }> = {
  privilegeLevel: { column: "privilege_level", check: (v) => v === "standard" || v === "elevated" || v === "admin", hint: "standard, elevated or admin" },
  dataClassification: { column: "data_classification", check: (v) => v === null || (typeof v === "string" && v.length >= 1 && v.length <= 100), hint: "text of at most 100 characters" },
  entitlementType: { column: "entitlement_type", check: (v) => v === null || (typeof v === "string" && v.length >= 1 && v.length <= 100), hint: "text of at most 100 characters" },
  requestable: { column: "requestable", check: (v) => typeof v === "boolean", hint: "true or false" },
  soxRelevant: { column: "sox_relevant", check: (v) => typeof v === "boolean", hint: "true or false" },
};

/** What a condition may read about an entitlement and its application. */
export const ENTITLEMENT_FIELDS = ["name", "entitlementType", "privilegeLevel", "dataClassification", "requestable", "soxRelevant", "hasOwner", "external"] as const;
export const APPLICATION_FIELDS = ["name", "displayName", "riskLevel", "dataClassification", "appType", "vendor"] as const;

type Row = Record<string, unknown>;

export function entitlementView(e: Row): Row {
  return {
    name: e.name ?? null,
    entitlementType: e.entitlement_type ?? null,
    privilegeLevel: e.privilege_level ?? null,
    dataClassification: e.data_classification ?? null,
    requestable: e.requestable ?? true,
    soxRelevant: e.sox_relevant ?? false,
    hasOwner: Boolean(e.owner_identity_id),
    external: Boolean(e.external_ref),
  };
}

export function applicationView(a: Row | null | undefined): Row | null {
  if (!a) return null;
  return {
    name: a.name ?? null,
    displayName: a.display_name ?? null,
    riskLevel: a.risk_level ?? null,
    dataClassification: a.data_classification ?? null,
    appType: a.app_type ?? null,
    vendor: a.vendor ?? null,
  };
}

export function classificationContext(entitlement: Row, application: Row | null, before: Row | null): RuleContext {
  const now = entitlementView(entitlement);
  return { entitlement: now, new: now, old: before ? entitlementView(before) : null, application: applicationView(application) };
}

/** The fields a condition may name, as the validator wants them (it checks only identity-shaped roots). */
export const KNOWN_FIELDS = [...ENTITLEMENT_FIELDS, ...APPLICATION_FIELDS];

export type ClassificationDefinition = { trigger: { type: string }; scope: { applications?: string[] }; condition: string; effects: RuleEffect[]; mode: RuleMode; priority: number };

export function workingDefinition(r: Row): ClassificationDefinition {
  return {
    trigger: { type: r.trigger_type as string },
    scope: (r.scope as ClassificationDefinition["scope"]) ?? {},
    condition: (r.condition as string) ?? "true",
    effects: (r.effects as RuleEffect[]) ?? [],
    mode: r.mode as RuleMode,
    priority: Number(r.priority ?? 100),
  };
}

export function toRuntimeRule(r: Row, which: "published" | "working"): Rule | null {
  const d = which === "published" ? ((r.published as ClassificationDefinition | null) ?? null) : workingDefinition(r);
  if (!d) return null;
  return {
    id: r.id as string,
    version: which === "published" ? Number(r.published_version) : Number(r.published_version) + 1,
    name: r.name as string,
    trigger: d.trigger,
    scope: d.scope,
    condition: d.condition,
    effects: d.effects,
    mode: d.mode,
    priority: d.priority,
    status: (which === "published" ? "published" : "draft") as RuleStatus,
    fourEyesApproved: which === "published",
  };
}

export type ClassificationRuleInput = {
  name?: unknown;
  description?: unknown;
  triggerType?: unknown;
  applicationIds?: unknown;
  condition?: unknown;
  effects?: unknown;
  mode?: unknown;
  priority?: unknown;
};
export type ValidClassificationRule = {
  name: string;
  description: string | null;
  trigger_type: ClassificationTrigger;
  scope: { applications?: string[] };
  condition: string;
  effects: RuleEffect[];
  mode: RuleMode;
  priority: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function effectValue(v: unknown): EffectValue | undefined {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.ref === "string" && Object.keys(o).length === 1) return { ref: o.ref };
    if (typeof o.template === "string" && Object.keys(o).length === 1) return { template: o.template };
  }
  return undefined;
}

/** Shape checks; the condition's meaning is checked by the runtime's validateRule. */
export function shapeClassificationRule(input: ClassificationRuleInput, current?: ValidClassificationRule): ValidClassificationRule | { error: string } {
  const name = input.name !== undefined ? text(input.name, 200) : (current?.name ?? null);
  if (!name) return { error: "name: give the rule a name" };
  const trigger = input.triggerType !== undefined ? input.triggerType : (current?.trigger_type ?? "entitlement.imported");
  if (!(CLASSIFICATION_TRIGGERS as readonly unknown[]).includes(trigger)) return { error: `triggerType: one of ${CLASSIFICATION_TRIGGERS.join(", ")}` };
  const condition = input.condition !== undefined ? (typeof input.condition === "string" ? input.condition.trim() || "true" : null) : (current?.condition ?? "true");
  if (condition === null || condition.length > 4000) return { error: "condition: text of at most 4000 characters" };
  const mode = input.mode !== undefined ? input.mode : (current?.mode ?? "report_only");
  if (mode !== "report_only" && mode !== "enforce") return { error: "mode: report_only or enforce" };
  const priority = input.priority !== undefined ? Number(input.priority) : (current?.priority ?? 100);
  if (!Number.isInteger(priority) || priority < 0 || priority > 100000) return { error: "priority: a whole number from 0 to 100000" };
  let applications = current?.scope.applications ?? [];
  if (input.applicationIds !== undefined) {
    if (!Array.isArray(input.applicationIds) || !input.applicationIds.every((a) => typeof a === "string" && UUID_RE.test(a)))
      return { error: "applicationIds: a list of applications, or empty for all" };
    applications = [...new Set(input.applicationIds as string[])];
  }
  const rawEffects = input.effects !== undefined ? input.effects : (current?.effects ?? []);
  if (!Array.isArray(rawEffects) || rawEffects.length < 1 || rawEffects.length > 10) return { error: "effects: one to ten" };
  const effects: RuleEffect[] = [];
  for (const [i, e] of (rawEffects as unknown[]).entries()) {
    const o = (e ?? {}) as Record<string, unknown>;
    const params = (o.params ?? {}) as Record<string, unknown>;
    if (o.type !== "set_attribute") return { error: `effects.${i}: classification rules set fields (set_attribute)` };
    const field = typeof params.attribute === "string" ? params.attribute : "";
    if (!SETTABLE[field]) return { error: `effects.${i}.attribute: one of ${Object.keys(SETTABLE).join(", ")}` };
    const value = effectValue(params.value);
    if (value === undefined) return { error: `effects.${i}.value: a value, { ref } or { template }` };
    if ((value === null || typeof value !== "object") && !SETTABLE[field].check(value)) return { error: `effects.${i}.value: ${SETTABLE[field].hint}` };
    effects.push({ type: "set_attribute", params: { attribute: field, value } });
  }
  return {
    name,
    description: input.description !== undefined ? text(input.description, 2000) : (current?.description ?? null),
    trigger_type: trigger as ClassificationTrigger,
    scope: applications.length ? { applications } : {},
    condition,
    effects,
    mode,
    priority,
  };
}

export type EntitlementWrite = {
  set: Row;
  provenance: Row;
  written: { ruleId: string; field: string; before: unknown; after: unknown }[];
  skipped: { ruleId: string; field: string; reason: string }[];
};

/**
 * Turns applied rules' effects into one write. A value a person set stays
 * (their decision wins); an invalid value is skipped; a value already in
 * place is not a write; a later rule wins on the same field.
 */
export function planEntitlementWrites(row: Row, applied: { ruleId: string; ruleVersion: number; effects: PlannedEffect[] }[], at: string): EntitlementWrite {
  const provenance: Row = { ...((row.field_provenance as Row) ?? {}) };
  const set: Row = {};
  const written: EntitlementWrite["written"] = [];
  const skipped: EntitlementWrite["skipped"] = [];
  for (const run of applied) {
    for (const e of run.effects) {
      if (e.type !== "set_attribute") continue;
      const field = String(e.params.attribute);
      const spec = SETTABLE[field];
      const value = e.params.value ?? null;
      if (!spec) {
        skipped.push({ ruleId: run.ruleId, field, reason: "not a field a rule may set" });
        continue;
      }
      if ((provenance[spec.column] as { by?: string } | undefined)?.by === "person") {
        skipped.push({ ruleId: run.ruleId, field, reason: "set by a person, whose decision a rule never overrides" });
        continue;
      }
      if (!spec.check(value)) {
        skipped.push({ ruleId: run.ruleId, field, reason: `the value is not ${spec.hint}` });
        continue;
      }
      const before = spec.column in set ? set[spec.column] : (row[spec.column] ?? null);
      if (before === value) continue;
      set[spec.column] = value;
      provenance[spec.column] = { by: "rule", ruleId: run.ruleId, ruleVersion: run.ruleVersion, at };
      const existing = written.findIndex((w) => w.field === field);
      if (existing >= 0) written.splice(existing, 1);
      written.push({ ruleId: run.ruleId, field, before: row[spec.column] ?? null, after: value });
    }
  }
  return { set, provenance, written, skipped };
}
