/**
 * OPERATIONS-P0-11 (runtime part, decision D12): the shared rule runtime of
 * design §5.2.1. One library parses, evaluates and simulates every module's
 * rules and produces their run log, so lifecycle rules, attribute rules,
 * classification rules and event subscriptions behave the same way. Rule
 * tables stay with their owners; they pass rows in as `Rule`.
 *
 * Pure (#9): no I/O and no clock. The runtime decides which rules fire and
 * what they would do; the owning module executes the planned effects through
 * its own governed paths (a grant through a request, a connector write
 * through the framework) and persists the run log with its own timestamps.
 */

import { evaluate, parseCondition, references, RuleSyntaxError, validateCondition, type Expr, type RuleContext } from "./expression";

export type RuleMode = "enforce" | "report_only";
export type RuleStatus = "draft" | "simulated" | "published" | "retired";

/** What a rule may touch. An empty or absent list allows everything of that kind. */
export type RuleScope = { identityTypes?: string[]; organizations?: string[]; sources?: string[]; applications?: string[] };

/**
 * A parameter value: a literal, `{ ref: "identity.firstName" }` read from
 * the context, or `{ template: "{identity.firstName} {identity.lastName}" }`
 * (each `{reference}` replaced by its value; a missing one by nothing).
 */
export type EffectValue = string | number | boolean | null | { ref: string } | { template: string };

const MAX_TEMPLATE = 500;
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_.]*)\}/g;

/** The references a parameter value reads. */
function valueRefs(v: EffectValue): string[] {
  if (v === null || typeof v !== "object") return [];
  if ("ref" in v) return [v.ref];
  return [...v.template.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

export const EFFECT_CATALOGUE = {
  set_attribute: { params: ["attribute", "value"], grants: false },
  set_identity_type: { params: ["value"], grants: false },
  set_manager: { params: ["value"], grants: false },
  set_owner: { params: ["value"], grants: false },
  set_sponsor: { params: ["value"], grants: false },
  add_to_group: { params: ["group"], grants: true },
  remove_from_group: { params: ["group"], grants: false },
  lifecycle_transition: { params: ["to"], grants: false },
  assign_package: { params: ["package"], grants: true },
  remove_package: { params: ["package"], grants: false },
  create_request: { params: ["item"], grants: true },
  open_certification: { params: [], grants: false },
  open_task: { params: ["assignee", "title"], grants: false },
  notify: { params: ["template", "recipients"], grants: false },
  propose_agent_state: { params: ["state"], grants: false },
  require_recertification: { params: [], grants: false },
} as const satisfies Record<string, { params: readonly string[]; grants: boolean }>;
export type EffectType = keyof typeof EFFECT_CATALOGUE;

export type RuleEffect = { type: EffectType; params: Record<string, EffectValue> };

export type Rule = {
  id: string;
  version: number;
  name: string;
  /** One entry of the trigger catalogue, e.g. "identity.created", "identity.attribute_changed". */
  trigger: { type: string; attribute?: string; source?: string };
  scope?: RuleScope;
  condition: string;
  effects: RuleEffect[];
  mode: RuleMode;
  /** Lower runs first; a later rule sees the enforced effects of earlier ones. */
  priority: number;
  status: RuleStatus;
  /** Published under four-eyes: only then may a granting effect be applied without a request (NN #15). */
  fourEyesApproved?: boolean;
};

export type RuleEvent = { type: string; changedAttributes?: string[]; source?: string };

/** Who the rule is about, for scope. */
export type RuleSubject = { id: string; identityType?: string | null; organization?: string | null; source?: string | null; application?: string | null };

export type PlannedEffect = {
  type: EffectType;
  params: Record<string, string | number | boolean | null>;
  /** A granting effect without a four-eyes rule becomes a request that goes through approval. */
  viaRequest: boolean;
  /** For set_* effects: the value before. */
  before?: unknown;
};

export type RuleOutcome = "applied" | "reported" | "not_matched" | "out_of_scope" | "error";

export type RunLogEntry = {
  ruleId: string;
  ruleVersion: number;
  subjectId: string;
  trigger: string;
  mode: RuleMode;
  outcome: RuleOutcome;
  effects: PlannedEffect[];
  error?: string;
};

const IDENTITY_FIELD_EFFECTS: Partial<Record<EffectType, string>> = { set_identity_type: "identityType", set_manager: "managerId", set_owner: "ownerId", set_sponsor: "sponsorId" };

function refValue(path: string, ctx: RuleContext): unknown {
  // Parsed through the language itself, so the same roots and safety apply.
  const expr = parseCondition(path);
  if (expr.kind !== "ref") throw new RuleSyntaxError(`"${path}" is not a reference`, 0);
  let v: unknown = ctx[expr.root];
  for (const key of expr.path) {
    if (v === null || v === undefined || typeof v !== "object") return undefined;
    v = Object.prototype.hasOwnProperty.call(v, key) ? (v as Record<string, unknown>)[key] : undefined;
  }
  return v;
}

function scalar(r: unknown): string | number | boolean | null {
  return r === undefined || r === null ? null : typeof r === "string" || typeof r === "number" || typeof r === "boolean" ? r : String(r);
}

function resolveParam(v: EffectValue, ctx: RuleContext): string | number | boolean | null {
  if (v === null || typeof v !== "object") return v;
  if ("ref" in v) return scalar(refValue(v.ref, ctx));
  if (v.template.length > MAX_TEMPLATE) throw new RuleSyntaxError(`A template is at most ${MAX_TEMPLATE} characters`, 0);
  const out = v.template
    .replace(PLACEHOLDER, (_, ref: string) => String(scalar(refValue(ref, ctx)) ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return out === "" ? null : out;
}

function inScope(scope: RuleScope | undefined, s: RuleSubject): boolean {
  if (!scope) return true;
  const ok = (list: string[] | undefined, v: string | null | undefined) => !list?.length || (v != null && list.some((x) => x.toLowerCase() === v.toLowerCase()));
  return ok(scope.identityTypes, s.identityType) && ok(scope.organizations, s.organization) && ok(scope.sources, s.source) && ok(scope.applications, s.application);
}

function triggerMatches(rule: Rule, event: RuleEvent): boolean {
  if (rule.trigger.type !== event.type) return false;
  if (rule.trigger.attribute && !(event.changedAttributes ?? []).some((a) => a.toLowerCase() === rule.trigger.attribute!.toLowerCase())) return false;
  if (rule.trigger.source && rule.trigger.source.toLowerCase() !== (event.source ?? "").toLowerCase()) return false;
  return true;
}

/** Applies an enforced effect to the context, so later rules see it. */
function applyToContext(effect: PlannedEffect, ctx: RuleContext): RuleContext {
  const field = effect.type === "set_attribute" ? String(effect.params.attribute) : IDENTITY_FIELD_EFFECTS[effect.type];
  if (!field) return ctx;
  const value = effect.params.value;
  return { ...ctx, identity: { ...(ctx.identity ?? {}), [field]: value }, new: { ...(ctx.new ?? ctx.identity ?? {}), [field]: value } };
}

export type EvaluateOptions = {
  /** Simulation may run drafts and simulated rules; live evaluation runs published rules only. */
  includeUnpublished?: boolean;
};

export type EvaluationResult = { log: RunLogEntry[]; context: RuleContext };

/**
 * Evaluates every rule for one event on one subject, in priority order (then
 * id, so the order is stable). A rule whose condition does not parse is an
 * error entry with no effects: it never fires on a guess (§17.4).
 */
export function evaluateRules(rules: Rule[], event: RuleEvent, subject: RuleSubject, context: RuleContext, opts: EvaluateOptions = {}): EvaluationResult {
  const runnable = rules
    .filter((r) => r.status === "published" || (opts.includeUnpublished && (r.status === "draft" || r.status === "simulated")))
    .filter((r) => triggerMatches(r, event))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  let ctx = context;
  const log: RunLogEntry[] = [];
  for (const rule of runnable) {
    const base = { ruleId: rule.id, ruleVersion: rule.version, subjectId: subject.id, trigger: event.type, mode: rule.mode };
    if (!inScope(rule.scope, subject)) {
      log.push({ ...base, outcome: "out_of_scope", effects: [] });
      continue;
    }
    let expr: Expr;
    let effects: PlannedEffect[];
    try {
      expr = parseCondition(rule.condition);
      if (!evaluate(expr, ctx)) {
        log.push({ ...base, outcome: "not_matched", effects: [] });
        continue;
      }
      effects = rule.effects.map((e) => {
        const params = Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, resolveParam(v, ctx)]));
        const field = e.type === "set_attribute" ? String(params.attribute) : IDENTITY_FIELD_EFFECTS[e.type];
        const planned: PlannedEffect = { type: e.type, params, viaRequest: EFFECT_CATALOGUE[e.type].grants && !rule.fourEyesApproved };
        if (field) planned.before = ctx.identity?.[field] ?? null;
        return planned;
      });
    } catch (err) {
      log.push({ ...base, outcome: "error", effects: [], error: err instanceof Error ? err.message : "Could not evaluate the rule" });
      continue;
    }
    if (rule.mode === "enforce") for (const e of effects) ctx = applyToContext(e, ctx);
    log.push({ ...base, outcome: rule.mode === "enforce" ? "applied" : "reported", effects });
  }
  return { log, context: ctx };
}

export type RuleProblem = { field: string; message: string };

/** Validates a rule before it is saved or published. Empty when valid. */
export function validateRule(rule: Pick<Rule, "trigger" | "condition" | "effects" | "priority">, known: { identityFields: Iterable<string>; triggers?: Iterable<string> }): RuleProblem[] {
  const problems: RuleProblem[] = [];
  const fields = [...known.identityFields];
  if (!rule.trigger?.type) problems.push({ field: "trigger", message: "Choose a trigger" });
  else if (known.triggers && ![...known.triggers].includes(rule.trigger.type)) problems.push({ field: "trigger", message: `Unknown trigger "${rule.trigger.type}"` });
  const cond = validateCondition(rule.condition, { identityFields: fields });
  if (!cond.ok) for (const message of cond.errors) problems.push({ field: "condition", message });
  if (!Number.isInteger(rule.priority)) problems.push({ field: "priority", message: "Priority is a whole number" });
  if (!rule.effects?.length) problems.push({ field: "effects", message: "Add at least one effect" });
  const lower = new Set(fields.map((f) => f.toLowerCase()));
  (rule.effects ?? []).forEach((e, i) => {
    const spec = (EFFECT_CATALOGUE as Record<string, { params: readonly string[] }>)[e.type];
    if (!spec) return problems.push({ field: `effects.${i}`, message: `Unknown effect "${e.type}"` });
    for (const p of spec.params) if (!(p in (e.params ?? {}))) problems.push({ field: `effects.${i}.${p}`, message: `"${e.type}" needs ${p}` });
    if (e.type === "set_attribute" && typeof e.params?.attribute === "string" && !lower.has(e.params.attribute.toLowerCase()))
      problems.push({ field: `effects.${i}.attribute`, message: `Unknown attribute "${e.params.attribute}": define it first` });
    for (const [k, v] of Object.entries(e.params ?? {})) {
      if (v !== null && typeof v === "object" && "template" in v && (typeof v.template !== "string" || v.template.length > MAX_TEMPLATE)) {
        problems.push({ field: `effects.${i}.${k}`, message: `A template is text of at most ${MAX_TEMPLATE} characters` });
        continue;
      }
      for (const ref of valueRefs(v)) {
        const check = validateCondition(`exists ${ref}`, { identityFields: fields });
        if (!check.ok) problems.push({ field: `effects.${i}.${k}`, message: check.errors[0] });
      }
    }
  });
  return problems;
}

export type SimulationInput = { subject: RuleSubject; context: RuleContext };

export type SimulationChange = { subjectId: string; ruleId: string; ruleVersion: number; type: EffectType; params: PlannedEffect["params"]; before?: unknown; viaRequest: boolean };

export type SimulationResult = {
  evaluated: number;
  /** Subjects at least one rule would change. */
  affected: number;
  gains: SimulationChange[];
  losses: SimulationChange[];
  changes: SimulationChange[];
  other: SimulationChange[];
  errors: { subjectId: string; ruleId: string; error: string }[];
  /** True when the affected share exceeds the mass-change guard: the run is held for approval. */
  held: boolean;
  log: RunLogEntry[];
};

const GAINS = new Set<EffectType>(["add_to_group", "assign_package", "create_request"]);
const LOSSES = new Set<EffectType>(["remove_from_group", "remove_package"]);
const CHANGES = new Set<EffectType>(["set_attribute", "set_identity_type", "set_manager", "set_owner", "set_sponsor", "lifecycle_transition"]);

/**
 * Simulation before publish (§5.2.1 guard rails): runs the rules as if
 * enforced (report-only rules included, drafts included) over the given
 * subjects and lists who would gain, lose or change what. A change that sets
 * a value to what it already is, is not a change.
 */
export function simulateRules(rules: Rule[], event: RuleEvent, inputs: SimulationInput[], opts: { maxAffectedShare?: number } = {}): SimulationResult {
  const asEnforced = rules.filter((r) => r.status !== "retired").map((r) => ({ ...r, mode: "enforce" as const }));
  const result: SimulationResult = { evaluated: inputs.length, affected: 0, gains: [], losses: [], changes: [], other: [], errors: [], held: false, log: [] };
  for (const { subject, context } of inputs) {
    const { log } = evaluateRules(asEnforced, event, subject, context, { includeUnpublished: true });
    let touched = false;
    for (const entry of log) {
      result.log.push(entry);
      if (entry.outcome === "error") result.errors.push({ subjectId: subject.id, ruleId: entry.ruleId, error: entry.error ?? "" });
      for (const e of entry.effects) {
        const change: SimulationChange = { subjectId: subject.id, ruleId: entry.ruleId, ruleVersion: entry.ruleVersion, type: e.type, params: e.params, viaRequest: e.viaRequest };
        if (CHANGES.has(e.type)) {
          const to = e.type === "lifecycle_transition" ? e.params.to : e.params.value;
          const from = e.type === "lifecycle_transition" ? (context.identity?.lifecycleState ?? null) : e.before;
          if ((from ?? null) === (to ?? null)) continue;
          change.before = from ?? null;
          result.changes.push(change);
        } else if (GAINS.has(e.type)) result.gains.push(change);
        else if (LOSSES.has(e.type)) result.losses.push(change);
        else result.other.push(change);
        touched = true;
      }
    }
    if (touched) result.affected++;
  }
  const share = opts.maxAffectedShare;
  result.held = share !== undefined && inputs.length > 0 && result.affected / inputs.length > share;
  return result;
}

/** Every reference a rule reads (condition and effect values), for the editor and for impact analysis. */
export function ruleReferences(rule: Pick<Rule, "condition" | "effects">): string[] {
  const out = new Set<string>();
  try {
    for (const r of references(parseCondition(rule.condition))) out.add(r);
  } catch {
    // An invalid condition has no references; validateRule reports it.
  }
  for (const e of rule.effects) for (const v of Object.values(e.params)) for (const ref of valueRefs(v)) out.add(ref);
  return [...out];
}
