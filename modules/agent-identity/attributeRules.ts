import type { FieldProvenance, IdentityAttributeDefinition, IdentityType } from "@/lib/shared/types/agent-identity";
import type { EffectValue, PlannedEffect, Rule, RuleContext, RuleEffect, RuleMode, RuleScope, RuleStatus } from "@/modules/operations/service";
import { validateAttributes } from "./identityRules";

/**
 * IDENTITY-P0-21 — attribute rules (design §5.2.1, the "user update rules"
 * of the Saviynt study): when an identity is created, imported or changes,
 * set one of its attributes from its other attributes. Evaluated by
 * Operations' shared rule runtime (D12); this file is what Identity decides
 * around it. Pure (#9).
 *
 * - What a rule reads: the identity's standard fields and custom
 *   attributes, its manager's, and for a change the old and new values.
 * - What a rule may set: a few descriptive standard fields and any custom
 *   attribute defined for the identity's type. Never status, lifecycle,
 *   ownership or anything that grants access.
 * - A rule never overrides a source (NN #7): a value a connected source set
 *   last stays, and the rule's write is skipped and logged. A value a rule
 *   writes carries provenance `rule:<id>` with the lowest precedence, so
 *   the next import from an authoritative source replaces it.
 */

export const ATTRIBUTE_RULE_TRIGGERS = [
  "identity.created",
  "identity.imported",
  "identity.attribute_changed",
  // Lifecycle triggers (design §5.2.1, F4): fired where a person's lifecycle event is recorded.
  "identity.activated",
  "identity.moved",
  "identity.manager_changed",
  "identity.leaver",
  "identity.end_date_reached",
] as const;
export type AttributeRuleTrigger = (typeof ATTRIBUTE_RULE_TRIGGERS)[number];

/**
 * The rule triggers a recorded lifecycle event fires. "Activated" is a
 * person becoming ACTIVE (joiner, rehire, leaver cancelled); a leaver the
 * end-date sweep found (origin "schedule") is also "end date reached".
 */
export function lifecycleRuleTriggers(
  event: { eventType: string; toState: string | null },
  origin: "manual" | "source" | "schedule",
): AttributeRuleTrigger[] {
  switch (event.eventType) {
    case "joiner":
    case "rehire":
    case "leaver_cancelled":
      return event.toState === "ACTIVE" ? ["identity.activated"] : [];
    case "mover":
      return ["identity.moved"];
    case "manager_change":
      return ["identity.manager_changed"];
    case "leaver":
      return origin === "schedule" ? ["identity.leaver", "identity.end_date_reached"] : ["identity.leaver"];
    default:
      return [];
  }
}

/** Standard fields a condition may read, by their database column. */
export const READABLE_FIELDS: Record<string, string> = {
  identityType: "identity_type",
  subtype: "subtype",
  displayName: "display_name",
  username: "username",
  email: "email",
  status: "status",
  lifecycleState: "lifecycle_state",
  department: "department",
  title: "title",
  businessUnit: "business_unit",
  location: "location",
  employmentType: "employment_type",
  organization: "organization",
  purpose: "purpose",
  startDate: "start_date",
  endDate: "end_date",
  privileged: "privileged",
  external: "external",
  sourceSystem: "source_system",
};

/** Standard fields a rule may set (descriptive only). */
export const SETTABLE_FIELDS: Record<string, string> = {
  displayName: "display_name",
  department: "department",
  title: "title",
  businessUnit: "business_unit",
  location: "location",
  employmentType: "employment_type",
  organization: "organization",
  purpose: "purpose",
};

/** Lowest precedence: any source's value (priority ≥ 1) wins over a rule's. */
export const RULE_PRIORITY = 1_000_000;

type Row = Record<string, unknown>;

/** What a rule sees of one identity row: standard fields, then custom attributes not shadowing them. */
export function identityView(row: Row | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  const attributes = (row.attributes as Record<string, unknown> | null) ?? {};
  for (const [name, value] of Object.entries(attributes)) out[name] = value;
  for (const [field, column] of Object.entries(READABLE_FIELDS)) if (column in row) out[field] = row[column] ?? null;
  return out;
}

export function ruleContext(identity: Row, manager: Row | null, before: Row | null): RuleContext {
  const now = identityView(identity);
  return { identity: now, new: now, old: before ? identityView(before) : null, manager: identityView(manager) };
}

/** The fields a condition or a value may name: standard ones plus the organization's attributes. */
export function knownFields(definitions: Pick<IdentityAttributeDefinition, "name" | "active">[]): string[] {
  return [...Object.keys(READABLE_FIELDS), ...definitions.filter((d) => d.active).map((d) => d.name)];
}

export type RuleRow = Row & { id: string; status: string };

export type RuleDefinition = {
  trigger: { type: string; attribute?: string; source?: string };
  scope: RuleScope;
  condition: string;
  effects: RuleEffect[];
  mode: RuleMode;
  priority: number;
};

/** The working definition of a rule row (what people edit and simulate). */
export function workingDefinition(r: Row): RuleDefinition {
  return {
    trigger: { type: r.trigger_type as string, ...(r.trigger_attribute ? { attribute: r.trigger_attribute as string } : {}), ...(r.trigger_source ? { source: r.trigger_source as string } : {}) },
    scope: (r.scope as RuleScope) ?? {},
    condition: (r.condition as string) ?? "true",
    effects: (r.effects as RuleEffect[]) ?? [],
    mode: r.mode as RuleMode,
    priority: Number(r.priority ?? 100),
  };
}

/** A rule as the runtime runs it: the published copy for live use, the working copy for simulation. */
export function toRuntimeRule(r: Row, which: "published" | "working"): Rule | null {
  const d = which === "published" ? ((r.published as RuleDefinition | null) ?? null) : workingDefinition(r);
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

export type RuleInput = {
  name?: unknown;
  description?: unknown;
  triggerType?: unknown;
  triggerAttribute?: unknown;
  triggerSource?: unknown;
  scope?: unknown;
  condition?: unknown;
  effects?: unknown;
  mode?: unknown;
  priority?: unknown;
};

export type ValidRuleInput = {
  name: string;
  description: string | null;
  trigger_type: AttributeRuleTrigger;
  trigger_attribute: string | null;
  trigger_source: string | null;
  scope: RuleScope;
  condition: string;
  effects: RuleEffect[];
  mode: RuleMode;
  priority: number;
};

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

/**
 * Shape checks for a rule's input; the meaning (condition, references,
 * attributes) is checked by the runtime's validateRule. Attribute rules
 * have one effect kind: set_attribute.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shapeRuleInput(input: RuleInput, current?: ValidRuleInput): ValidRuleInput | { error: string } {
  const merged = {
    name: input.name !== undefined ? text(input.name, 200) : (current?.name ?? null),
    description: input.description !== undefined ? text(input.description, 2000) : (current?.description ?? null),
    trigger_type: input.triggerType !== undefined ? input.triggerType : current?.trigger_type,
    trigger_attribute: input.triggerAttribute !== undefined ? text(input.triggerAttribute, 100) : (current?.trigger_attribute ?? null),
    trigger_source: input.triggerSource !== undefined ? text(input.triggerSource, 200) : (current?.trigger_source ?? null),
    scope: input.scope !== undefined ? input.scope : (current?.scope ?? {}),
    condition: input.condition !== undefined ? (typeof input.condition === "string" ? input.condition.trim() || "true" : null) : (current?.condition ?? "true"),
    effects: input.effects !== undefined ? input.effects : (current?.effects ?? []),
    mode: input.mode !== undefined ? input.mode : (current?.mode ?? "report_only"),
    priority: input.priority !== undefined ? Number(input.priority) : (current?.priority ?? 100),
  };
  if (!merged.name) return { error: "name: give the rule a name" };
  if (!(ATTRIBUTE_RULE_TRIGGERS as readonly unknown[]).includes(merged.trigger_type)) return { error: `triggerType: one of ${ATTRIBUTE_RULE_TRIGGERS.join(", ")}` };
  if (merged.trigger_attribute && merged.trigger_type !== "identity.attribute_changed") return { error: "triggerAttribute: only for identity.attribute_changed" };
  if (merged.trigger_source && merged.trigger_type === "identity.created") return { error: "triggerSource: not for identity.created" };
  if (merged.condition === null || merged.condition.length > 4000) return { error: "condition: text of at most 4000 characters" };
  if (merged.mode !== "report_only" && merged.mode !== "enforce") return { error: "mode: report_only or enforce" };
  if (!Number.isInteger(merged.priority) || merged.priority < 0 || merged.priority > 100000) return { error: "priority: a whole number from 0 to 100000" };
  const scope = merged.scope as Record<string, unknown>;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return { error: "scope: an object" };
  const identityTypes = scope.identityTypes ?? [];
  const sources = scope.sources ?? [];
  if (!Array.isArray(identityTypes) || !identityTypes.every((t) => typeof t === "string") || !Array.isArray(sources) || !sources.every((t) => typeof t === "string"))
    return { error: "scope: identityTypes and sources are lists of names" };
  if (Object.keys(scope).some((k) => k !== "identityTypes" && k !== "sources")) return { error: "scope: identityTypes and sources only" };
  if (!Array.isArray(merged.effects) || merged.effects.length < 1 || merged.effects.length > 20) return { error: "effects: one to twenty" };
  const effects: RuleEffect[] = [];
  for (const [i, e] of (merged.effects as unknown[]).entries()) {
    const o = (e ?? {}) as Record<string, unknown>;
    const params = (o.params ?? {}) as Record<string, unknown>;
    if (o.type === "open_task") {
      // A task about the identity, for its manager or for identity administrators. It grants nothing.
      if (params.assignee !== "manager" && params.assignee !== "identity_admins") return { error: `effects.${i}.assignee: manager or identity_admins` };
      const title = effectValue(params.title);
      const titleText = typeof title === "string" ? title : title && typeof title === "object" && "template" in title ? title.template : null;
      if (!titleText || titleText.trim().length < 3 || titleText.length > 200) return { error: `effects.${i}.title: what to do, 3 to 200 characters` };
      effects.push({ type: "open_task", params: { assignee: params.assignee, title: title as EffectValue } });
      continue;
    }
    if (o.type === "add_to_group" || o.type === "assign_package") {
      // IDENTITY-P0-21 (owner decision 2026-10-17): a grant either waits for a person's approval or applies
      // automatically; the rule itself is always published under four-eyes.
      const key = o.type === "add_to_group" ? "group" : "package";
      const target = params[key];
      if (typeof target !== "string" || !UUID.test(target)) return { error: `effects.${i}.${key}: which ${key} (an id)` };
      if (params.approval !== "required" && params.approval !== "automatic") return { error: `effects.${i}.approval: required or automatic` };
      effects.push({ type: o.type, params: { [key]: target, approval: params.approval } });
      continue;
    }
    if (o.type !== "set_attribute") return { error: `effects.${i}: a rule sets an attribute, opens a task, adds to a group or assigns a package` };
    if (typeof params.attribute !== "string" || !params.attribute) return { error: `effects.${i}.attribute: which attribute to set` };
    const value = effectValue(params.value);
    if (value === undefined) return { error: `effects.${i}.value: a value, { ref } or { template }` };
    effects.push({ type: "set_attribute", params: { attribute: params.attribute, value } });
  }
  return {
    name: merged.name,
    description: merged.description,
    trigger_type: merged.trigger_type as AttributeRuleTrigger,
    trigger_attribute: merged.trigger_attribute,
    trigger_source: merged.trigger_source,
    scope: { ...(identityTypes.length ? { identityTypes: identityTypes as string[] } : {}), ...(sources.length ? { sources: sources as string[] } : {}) },
    condition: merged.condition,
    effects,
    mode: merged.mode as RuleMode,
    priority: merged.priority,
  };
}

/** Attributes a rule may set for an identity type: settable standard fields and that type's custom attributes. */
export function settableFor(definitions: Pick<IdentityAttributeDefinition, "name" | "active" | "identityType">[], identityType?: IdentityType): string[] {
  return [...Object.keys(SETTABLE_FIELDS), ...definitions.filter((d) => d.active && (!identityType || d.identityType === null || d.identityType === identityType)).map((d) => d.name)];
}

export type PlannedWrite = {
  /** Column updates for standard fields. */
  columns: Row;
  /** The full custom attributes after the writes, when any changed. */
  attributes: Record<string, unknown> | null;
  provenance: FieldProvenance;
  written: { ruleId: string; attribute: string; before: unknown; after: unknown }[];
  skipped: { ruleId: string; attribute: string; reason: string }[];
};

/**
 * Turns the set_attribute effects of applied (enforced) rules into one
 * write. Later rules win over earlier ones on the same attribute, as the
 * runtime already folded them; a value already in place is not a write.
 */
export function planAttributeWrites(
  row: Row,
  applied: { ruleId: string; ruleVersion: number; effects: PlannedEffect[] }[],
  definitions: Pick<IdentityAttributeDefinition, "name" | "displayName" | "identityType" | "dataType" | "required" | "allowedValues" | "validationRegex" | "active">[],
  at: string,
): PlannedWrite {
  const identityType = row.identity_type as IdentityType;
  const provenance: FieldProvenance = { ...((row.field_provenance as FieldProvenance) ?? {}) };
  const current = (row.attributes as Record<string, unknown>) ?? {};
  const attributes: Record<string, unknown> = { ...current };
  const columns: Row = {};
  const written: PlannedWrite["written"] = [];
  const skipped: PlannedWrite["skipped"] = [];
  const custom = new Map(definitions.filter((d) => d.active && (d.identityType === null || d.identityType === identityType)).map((d) => [d.name, d]));

  for (const run of applied) {
    for (const e of run.effects) {
      if (e.type !== "set_attribute") continue;
      const attribute = String(e.params.attribute);
      const value = e.params.value ?? null;
      const column = SETTABLE_FIELDS[attribute];
      const key = column ? attribute : `attributes.${attribute}`;
      const skip = (reason: string) => skipped.push({ ruleId: run.ruleId, attribute, reason });
      if (!column && !custom.has(attribute)) {
        skip("not an attribute this identity type has");
        continue;
      }
      const owner = provenance[key];
      if (owner && !owner.sourceId.startsWith("rule:")) {
        skip("set by a connected source, which a rule never overrides");
        continue;
      }
      if (column) {
        if (value !== null && (typeof value !== "string" || value.length > 300)) {
          skip("the value is not text of at most 300 characters");
          continue;
        }
        if (attribute === "displayName" && !value) {
          skip("a display name cannot be empty");
          continue;
        }
        const before = (column in columns ? columns[column] : row[column]) ?? null;
        if (before === value) continue;
        columns[column] = value;
        written.push({ ruleId: run.ruleId, attribute, before, after: value });
      } else {
        try {
          validateAttributes(value === null ? {} : { [attribute]: value }, [...custom.values()], identityType);
        } catch (err) {
          skip(err instanceof Error ? err.message : "invalid value");
          continue;
        }
        const before = attributes[attribute] ?? null;
        if (before === value) continue;
        if (value === null) delete attributes[attribute];
        else attributes[attribute] = value;
        written.push({ ruleId: run.ruleId, attribute, before, after: value });
      }
      provenance[key] = { sourceId: `rule:${run.ruleId}`, priority: RULE_PRIORITY, at, ruleId: run.ruleId, ruleVersion: run.ruleVersion };
    }
  }
  const attributesChanged = Object.keys({ ...current, ...attributes }).some((k) => current[k] !== attributes[k]);
  return { columns, attributes: attributesChanged ? attributes : null, provenance, written, skipped };
}

/** The database row an Identity object came from, as far as rules read it. */
export function rowFromIdentity(identity: Record<string, unknown>): Row {
  const row: Row = { attributes: identity.attributes ?? {} };
  for (const [field, column] of Object.entries(READABLE_FIELDS)) row[column] = identity[field] ?? null;
  return row;
}

/** The fields an edit changed, standard and custom, by name (for "attribute changed" triggers). */
export function changedFields(before: Row, after: Row): string[] {
  const out: string[] = [];
  for (const [field, column] of Object.entries(READABLE_FIELDS)) if ((before[column] ?? null) !== (after[column] ?? null)) out.push(field);
  const a = (before.attributes as Record<string, unknown>) ?? {};
  const b = (after.attributes as Record<string, unknown>) ?? {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] ?? null) !== (b[k] ?? null)) out.push(k);
  return out;
}

/** Key order is not meaning: stored JSON comes back with its keys reordered. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Whether two rule definitions say the same thing. */
export function sameDefinition(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
