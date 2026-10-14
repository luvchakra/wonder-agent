import { ApiError } from "@/lib/shared/types/foundation";
import { EMPTY_CONFIG, ONBOARDING_OPERATIONS, validateOnboardingConfig } from "./onboardingRules";
import { validateEntitlementType, type ValidEntitlementType } from "./entitlementTypeRules";

/**
 * ACCESS-P0-34 (design §5.8.2, §14) — application onboarding templates,
 * pure (#9). A template names a connection type and carries the onboarding
 * configuration's defaults, default owners, the entitlement types to
 * declare, and a questionnaire. Starting onboarding from it fills the draft;
 * every later step (validate, simulate, four-eyes approval, promote) is
 * unchanged.
 */

/** The onboarding configuration fields a template may preset (never the integration, which is the application's own). */
export const TEMPLATE_CONFIG_KEYS = [
  "accountIdentifierField",
  "correlationAccountField",
  "correlationIdentityField",
  "entitlementSource",
  "requestPolicy",
  "certificationPolicy",
  ...ONBOARDING_OPERATIONS,
] as const;

export const QUESTION_TYPES = ["text", "yes_no", "choice"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type TemplateQuestion = { key: string; label: string; type: QuestionType; options?: string[]; required: boolean };
export type TemplateEntitlementType = Required<Pick<ValidEntitlementType, "name">> & Omit<ValidEntitlementType, "name" | "request_policy_id">;
export type TemplateDefaults = { config: Record<string, unknown>; businessOwnerIdentityId: string | null; technicalOwnerIdentityId: string | null };

export type TemplateInput = {
  name?: unknown;
  description?: unknown;
  connectionTypeKey?: unknown;
  defaults?: unknown;
  entitlementTypes?: unknown;
  questions?: unknown;
};

export type ValidTemplate = {
  name: string;
  description: string | null;
  connection_type_key: string | null;
  defaults: TemplateDefaults;
  entitlement_types: TemplateEntitlementType[];
  questions: TemplateQuestion[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[a-z][a-z0-9_]{0,49}$/;
/** A connector definition key (built-in or custom), as connections are typed since the connector framework. */
const TYPE_KEY_RE = /^[a-z][a-z0-9-]{1,62}$/;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** A question's key from its label: lower case, words joined by underscores. */
export function questionKey(label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 50);
  return key || "question";
}

function validDefaults(raw: unknown, connectionTypeKey: string | null): TemplateDefaults | { error: string } {
  const o = raw === undefined || raw === null ? {} : raw;
  if (typeof o !== "object" || Array.isArray(o)) return { error: "defaults: an object" };
  const input = o as Record<string, unknown>;
  const config: Record<string, unknown> = {};
  for (const k of TEMPLATE_CONFIG_KEYS) if (input[k] !== undefined && input[k] !== "") config[k] = input[k];
  const { entitlementSource, ...rest } = config;
  try {
    // The configuration's own checks, without the integration (the application brings it).
    validateOnboardingConfig(rest, EMPTY_CONFIG);
  } catch (err) {
    return { error: `defaults.${err instanceof ApiError ? err.message : "invalid"}` };
  }
  if (entitlementSource !== undefined) {
    if (entitlementSource !== "connector" && entitlementSource !== "manual") return { error: "defaults.entitlementSource: connector or manual" };
    if (entitlementSource === "connector" && !connectionTypeKey) return { error: "defaults.entitlementSource: entitlements from the connector need a connection type" };
  }
  const owners: Record<string, string | null> = {};
  for (const k of ["businessOwnerIdentityId", "technicalOwnerIdentityId"] as const) {
    const v = input[k];
    if (v === undefined || v === null || v === "") owners[k] = null;
    else if (typeof v !== "string" || !UUID_RE.test(v)) return { error: `defaults.${k}: an identity, or empty` };
    else owners[k] = v;
  }
  return { config, businessOwnerIdentityId: owners.businessOwnerIdentityId, technicalOwnerIdentityId: owners.technicalOwnerIdentityId };
}

function validTypes(raw: unknown): TemplateEntitlementType[] | { error: string } {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 30) return { error: "entitlementTypes: a list of at most 30" };
  const out: TemplateEntitlementType[] = [];
  const seen = new Set<string>();
  for (const [i, t] of raw.entries()) {
    const o = (t ?? {}) as Record<string, unknown>;
    const v = validateEntitlementType({ name: o.name, requestMode: o.requestMode, certifiable: o.certifiable, defaultDurationDays: o.defaultDurationDays, maxDurationDays: o.maxDurationDays }, true);
    if ("error" in v) return { error: `entitlementTypes.${i}.${v.error}` };
    const key = v.name!.toLowerCase();
    if (seen.has(key)) return { error: `entitlementTypes.${i}.name: "${v.name}" is listed twice` };
    seen.add(key);
    out.push({ ...v, name: v.name! });
  }
  return out;
}

function validQuestions(raw: unknown): TemplateQuestion[] | { error: string } {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 20) return { error: "questions: a list of at most 20" };
  const out: TemplateQuestion[] = [];
  const keys = new Set<string>();
  for (const [i, q] of raw.entries()) {
    const o = (q ?? {}) as Record<string, unknown>;
    const label = text(o.label, 300);
    if (!label) return { error: `questions.${i}.label: the question` };
    const type = o.type ?? "text";
    if (!(QUESTION_TYPES as readonly unknown[]).includes(type)) return { error: `questions.${i}.type: one of ${QUESTION_TYPES.join(", ")}` };
    const key = o.key === undefined || o.key === "" ? questionKey(label) : o.key;
    if (typeof key !== "string" || !KEY_RE.test(key)) return { error: `questions.${i}.key: lower-case letters, digits and underscores` };
    if (keys.has(key)) return { error: `questions.${i}.key: "${key}" is used twice` };
    keys.add(key);
    const question: TemplateQuestion = { key, label, type: type as QuestionType, required: o.required === true };
    if (type === "choice") {
      const options = Array.isArray(o.options) ? [...new Set(o.options.map((x) => text(x, 100)).filter((x): x is string => !!x))] : [];
      if (options.length < 2 || options.length > 20) return { error: `questions.${i}.options: two to twenty choices` };
      question.options = options;
    }
    out.push(question);
  }
  return out;
}

/** Validates a new template, or a change merged onto the current one. */
export function validateTemplate(input: TemplateInput, current?: ValidTemplate): ValidTemplate | { error: string } {
  const name = input.name !== undefined ? text(input.name, 200) : (current?.name ?? null);
  if (!name) return { error: "name: give the template a name" };
  let connectionTypeKey = current?.connection_type_key ?? null;
  if (input.connectionTypeKey !== undefined) {
    if (input.connectionTypeKey === null || input.connectionTypeKey === "") connectionTypeKey = null;
    else if (typeof input.connectionTypeKey !== "string" || !TYPE_KEY_RE.test(input.connectionTypeKey)) return { error: "connectionTypeKey: a connection type, or empty for none" };
    else connectionTypeKey = input.connectionTypeKey;
  }
  const defaults =
    input.defaults !== undefined
      ? validDefaults(input.defaults, connectionTypeKey)
      : current
        ? validDefaults(
            { ...current.defaults.config, businessOwnerIdentityId: current.defaults.businessOwnerIdentityId, technicalOwnerIdentityId: current.defaults.technicalOwnerIdentityId },
            connectionTypeKey,
          )
        : validDefaults({}, connectionTypeKey);
  if ("error" in defaults) return defaults;
  const entitlementTypes = input.entitlementTypes !== undefined ? validTypes(input.entitlementTypes) : (current?.entitlement_types ?? []);
  if ("error" in entitlementTypes) return entitlementTypes;
  const questions = input.questions !== undefined ? validQuestions(input.questions) : (current?.questions ?? []);
  if ("error" in questions) return questions;
  return {
    name,
    description: input.description !== undefined ? text(input.description, 2000) : (current?.description ?? null),
    connection_type_key: connectionTypeKey,
    defaults,
    entitlement_types: entitlementTypes,
    questions,
  };
}

/** The connection type of a connection: the connector definition its config names (null for a connection without one). */
export function connectionTypeKeyOf(connection: { config?: Record<string, unknown> | null } | null): string | null {
  const ref = connection?.config?.definition as { key?: unknown } | undefined;
  return typeof ref?.key === "string" && TYPE_KEY_RE.test(ref.key) ? ref.key : null;
}

/** Whether a template may start an application's onboarding: a typed template only for a connection of that type. */
export function templateFits(templateTypeId: string | null, applicationTypeId: string | null): boolean {
  return templateTypeId === null || templateTypeId === applicationTypeId;
}

export type Answers = Record<string, string | boolean>;

/** Validates answers and merges them onto the current ones; an empty answer removes it. */
export function validateAnswers(questions: TemplateQuestion[], input: unknown, current: Answers = {}): { answers: Answers } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "answers: an object of question keys" };
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const next: Answers = { ...current };
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const q = byKey.get(key);
    if (!q) return { error: `answers.${key}: not a question of this template` };
    if (raw === null || raw === undefined || raw === "") {
      delete next[key];
      continue;
    }
    if (q.type === "yes_no") {
      const v = raw === true || raw === "true" || raw === "yes" ? true : raw === false || raw === "false" || raw === "no" ? false : null;
      if (v === null) return { error: `answers.${key}: yes or no` };
      next[key] = v;
    } else if (q.type === "choice") {
      if (typeof raw !== "string" || !q.options?.includes(raw)) return { error: `answers.${key}: one of ${q.options?.join(", ")}` };
      next[key] = raw;
    } else {
      const v = text(raw, 2000);
      if (!v) return { error: `answers.${key}: text of at most 2000 characters` };
      next[key] = v;
    }
  }
  return { answers: next };
}

/** The required questions still unanswered, by label. */
export function missingAnswers(questions: TemplateQuestion[], answers: Answers): string[] {
  return questions.filter((q) => q.required && (answers[q.key] === undefined || answers[q.key] === "")).map((q) => q.label);
}
