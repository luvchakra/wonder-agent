import { ApiError } from "@/lib/shared/types/foundation";

/**
 * INTEGRATION-P0-12 — AI-assisted onboarding proposals, the deterministic
 * half (#9). From an OpenAPI document or a sample account payload it
 * proposes an account schema, identifier, correlation, entitlement field,
 * the operations the API appears to support, a risk hint and
 * requestability, with assumptions, per-section confidence, evidence,
 * unresolved questions, destructive actions and suggested tests (spec §8.2).
 *
 * Everything it proposes names only fields and paths found in the input.
 * An AI refinement (see `refineWithAi`) may only choose among these
 * candidates and add questions; anything else it returns is dropped. The
 * input is external content: text in it that reads like instructions is
 * flagged as a warning and otherwise treated as data (§17.2). Nothing here
 * activates anything — a proposal only becomes configuration when a person
 * applies it to an onboarding draft, which still has to be validated,
 * simulated, approved and promoted.
 */

const fail = (message: string): never => {
  throw new ApiError(400, "VALIDATION_FAILED", message);
};

export const MAX_PROPOSAL_INPUT_BYTES = 1024 * 1024;
const OPERATIONS = ["createAccount", "updateAccount", "disableAccount", "deleteAccount", "grantAccess", "revokeAccess"] as const;
export type ProposalOperation = (typeof OPERATIONS)[number];
type Confidence = "high" | "medium" | "low";

export type OnboardingProposal = {
  inputKind: "openapi" | "sample";
  accountFields: string[];
  identifier: { field: string | null; candidates: string[]; confidence: Confidence };
  correlation: { accountField: string | null; identityField: "email" | "username" | "displayName" | null; candidates: string[]; confidence: Confidence };
  entitlementField: { field: string | null; candidates: string[]; confidence: Confidence };
  lastUsedField: string | null;
  statusField: string | null;
  privilegedField: string | null;
  operations: Record<ProposalOperation, { supported: boolean; evidence: string | null }>;
  risk: { dataClassification: "internal" | "confidential" | "restricted" | null; sensitiveFields: string[] };
  requestPolicy: "manager_approval" | "owner_approval" | "manager_and_owner";
  certificationPolicy: "quarterly" | "semiannual" | "annual";
  assumptions: string[];
  evidence: string[];
  unresolvedQuestions: string[];
  destructiveActions: string[];
  suggestedTests: string[];
  warnings: string[];
  overallConfidence: Confidence;
};

// ---------------------------------------------------------------- input

export function parseProposalInput(kind: unknown, raw: unknown): { kind: "openapi" | "sample"; doc: unknown } {
  if (kind !== "openapi" && kind !== "sample") fail("kind: openapi or sample");
  if (typeof raw !== "string" || !raw.trim()) fail("input: paste the JSON");
  if (Buffer.byteLength(raw as string) > MAX_PROPOSAL_INPUT_BYTES) fail("input: larger than 1 MB");
  try {
    return { kind: kind as "openapi" | "sample", doc: JSON.parse(raw as string) };
  } catch {
    return fail("input: not valid JSON");
  }
}

const INSTRUCTION_RE = /\b(ignore (all |any )?(previous|prior|above) instructions|disregard (the )?(rules|instructions)|you are now|system prompt|approve (this|all|the request)|grant (admin|full) access|set .{0,20}(status|policy) to)\b/i;

/** Text in the input addressed to a model: recorded as a warning, never obeyed (§17.2). */
export function findInstructionLikeText(value: unknown, path = "$", out: string[] = []): string[] {
  if (out.length >= 5) return out;
  if (typeof value === "string") {
    if (INSTRUCTION_RE.test(value)) out.push(`${path} contains text addressed to an AI ("${value.slice(0, 80)}"); it was treated as data`);
  } else if (Array.isArray(value)) {
    value.slice(0, 200).forEach((v, i) => findInstructionLikeText(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value).slice(0, 500)) findInstructionLikeText(v, `${path}.${k}`, out);
  }
  return out;
}

// ---------------------------------------------------------------- field heuristics

const lc = (s: string) => s.toLowerCase();
const leaf = (f: string) => lc(f.split(".").at(-1) ?? f);
const ID_NAMES = ["id", "userid", "user_id", "accountid", "account_id", "externalid", "external_id", "uid", "employeeid", "employee_id", "login", "username", "user_name"];
const EMAIL_NAMES = ["email", "mail", "emailaddress", "email_address", "primaryemail", "workemail", "userprincipalname", "upn"];
const USERNAME_NAMES = ["username", "user_name", "login", "loginname", "samaccountname", "handle"];
const DISPLAY_NAMES = ["displayname", "display_name", "fullname", "full_name", "name"];
const ENTITLEMENT_NAMES = ["groups", "roles", "entitlements", "permissions", "memberof", "member_of", "profiles", "licenses", "teams"];
const LAST_USED_NAMES = ["lastlogin", "last_login", "lastloginat", "last_login_at", "lastsignin", "lastsigninat", "lastusedat", "last_used_at", "lastactivity", "lastlogontimestamp"];
const STATUS_NAMES = ["status", "state", "active", "enabled", "disabled", "locked", "suspended"];
const PRIVILEGED_NAMES = ["admin", "isadmin", "is_admin", "privileged", "isprivileged", "superuser", "is_superuser"];
const RESTRICTED = ["ssn", "socialsecurity", "salary", "compensation", "bankaccount", "iban", "creditcard", "cardnumber", "passport", "taxid", "dateofbirth", "dob", "diagnosis", "medical"];
const CONFIDENTIAL = ["phone", "mobile", "address", "birthdate", "homeaddress", "personalemail", "manager"];

const rank = (fields: string[], names: string[]) =>
  fields.filter((f) => names.includes(leaf(f).replace(/-/g, "_")) || names.includes(leaf(f).replace(/[-_]/g, ""))).sort((a, b) => a.split(".").length - b.split(".").length);

/** Every field path of an object, depth-limited, arrays described by their first element. */
export function fieldPaths(value: unknown, prefix = "", depth = 0, out: Set<string> = new Set()): Set<string> {
  if (depth > 4 || out.size > 300 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) return value.length ? fieldPaths(value[0], prefix, depth + 1, out) : out;
  for (const [k, v] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(k)) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    if (v && typeof v === "object" && !Array.isArray(v)) fieldPaths(v, path, depth + 1, out);
  }
  return out;
}

function classify(fields: string[]): OnboardingProposal["risk"] {
  const norm = (f: string) => leaf(f).replace(/[-_]/g, "");
  const restricted = fields.filter((f) => RESTRICTED.some((r) => norm(f).includes(r)));
  const confidential = fields.filter((f) => CONFIDENTIAL.some((r) => norm(f).includes(r)));
  if (restricted.length) return { dataClassification: "restricted", sensitiveFields: restricted.slice(0, 10) };
  if (confidential.length) return { dataClassification: "confidential", sensitiveFields: confidential.slice(0, 10) };
  return { dataClassification: fields.length ? "internal" : null, sensitiveFields: [] };
}

const conf = (n: number, strong: boolean): Confidence => (n === 1 && strong ? "high" : n >= 1 ? "medium" : "low");

// ---------------------------------------------------------------- OpenAPI

type OpenApiOp = { method: string; path: string };

function openApiOperations(doc: Record<string, unknown>): OpenApiOp[] {
  const paths = (doc.paths && typeof doc.paths === "object" ? doc.paths : {}) as Record<string, Record<string, unknown>>;
  const ops: OpenApiOp[] = [];
  for (const [p, item] of Object.entries(paths).slice(0, 500)) {
    if (!item || typeof item !== "object") continue;
    for (const m of ["get", "post", "put", "patch", "delete"]) if (m in item) ops.push({ method: m.toUpperCase(), path: p });
  }
  return ops;
}

const USER_PATH = /\/(users?|accounts?|members?|people|employees?|identities)(\/|$)/i;
const GROUP_PATH = /\/(groups?|roles?|entitlements?|permissions?|teams?)(\/|$)/i;

function openApiSchemaFields(doc: Record<string, unknown>): { schema: string | null; fields: string[] } {
  const components = (doc.components && typeof doc.components === "object" ? doc.components : {}) as Record<string, unknown>;
  const schemas = (components.schemas ?? doc.definitions ?? {}) as Record<string, { properties?: Record<string, unknown> }>;
  const names = Object.keys(schemas);
  const pick = names.find((n) => /^(user|account|member|person|employee)s?$/i.test(n)) ?? names.find((n) => /(user|account)/i.test(n)) ?? null;
  if (!pick) return { schema: null, fields: [] };
  const props = schemas[pick]?.properties ?? {};
  return { schema: pick, fields: [...fieldPaths(Object.fromEntries(Object.keys(props).map((k) => [k, (props[k] as { properties?: unknown })?.properties ?? true])))] };
}

// ---------------------------------------------------------------- analysis

export function analyze(kind: "openapi" | "sample", doc: unknown): OnboardingProposal {
  const warnings = findInstructionLikeText(doc);
  const evidence: string[] = [];
  const assumptions: string[] = [];
  const questions: string[] = [];
  let fields: string[] = [];
  const operations = Object.fromEntries(OPERATIONS.map((o) => [o, { supported: false, evidence: null as string | null }])) as OnboardingProposal["operations"];

  if (kind === "openapi") {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail("input: an OpenAPI document is a JSON object");
    const d = doc as Record<string, unknown>;
    if (!d.openapi && !d.swagger) fail("input: not an OpenAPI or Swagger document");
    const { schema, fields: schemaFields } = openApiSchemaFields(d);
    fields = schemaFields;
    if (schema) evidence.push(`Account fields from the "${schema}" schema (${fields.length} fields)`);
    else questions.push("The document defines no user or account schema: which object represents an account?");
    const ops = openApiOperations(d);
    const mark = (op: ProposalOperation, found: OpenApiOp | undefined) => {
      if (found) operations[op] = { supported: true, evidence: `${found.method} ${found.path}` };
    };
    const userOps = ops.filter((o) => USER_PATH.test(o.path));
    const groupOps = ops.filter((o) => GROUP_PATH.test(o.path));
    mark("createAccount", userOps.find((o) => o.method === "POST" && !/\{[^}]+\}\/?$/.test(o.path)));
    mark("updateAccount", userOps.find((o) => (o.method === "PATCH" || o.method === "PUT") && /\{[^}]+\}/.test(o.path)));
    mark("deleteAccount", userOps.find((o) => o.method === "DELETE" && /\{[^}]+\}\/?$/.test(o.path) && !GROUP_PATH.test(o.path)));
    const disable = userOps.find((o) => /(disable|deactivate|suspend|lock)/i.test(o.path));
    mark("disableAccount", disable ?? (operations.updateAccount.supported ? userOps.find((o) => o.method === "PATCH" && /\{[^}]+\}/.test(o.path)) : undefined));
    if (!disable && operations.disableAccount.supported) assumptions.push("Disabling is assumed to be a PATCH of the account's status field; the API has no dedicated disable endpoint");
    mark("grantAccess", groupOps.find((o) => (o.method === "POST" || o.method === "PUT" || o.method === "PATCH") && /member|user/i.test(o.path)));
    mark("revokeAccess", groupOps.find((o) => o.method === "DELETE" && /member|user/i.test(o.path)));
    evidence.push(`${ops.length} operations; ${userOps.length} on accounts, ${groupOps.length} on groups or roles`);
    if (!userOps.length) questions.push("No account endpoints were found: is this the right API?");
  } else {
    const sample = Array.isArray(doc) ? doc[0] : doc && typeof doc === "object" && Array.isArray((doc as { Resources?: unknown }).Resources) ? (doc as { Resources: unknown[] }).Resources[0] : doc;
    if (!sample || typeof sample !== "object") fail("input: a sample account is a JSON object (or an array of them)");
    fields = [...fieldPaths(sample)];
    evidence.push(`${fields.length} fields in the sample account`);
    assumptions.push("A sample payload shows the fields, not the operations: no operation is proposed from it");
  }

  const idCandidates = rank(fields, ID_NAMES);
  const emails = rank(fields, EMAIL_NAMES);
  const usernames = rank(fields, USERNAME_NAMES);
  const displays = rank(fields, DISPLAY_NAMES);
  const entitlements = rank(fields, ENTITLEMENT_NAMES);
  const identifier = idCandidates.find((f) => /^(id|externalid|external_id|accountid|account_id|userid|user_id|uid)$/i.test(leaf(f))) ?? idCandidates[0] ?? null;
  if (!identifier) questions.push("No field looks like an account identifier: which field is unique per account?");
  const corrField = emails[0] ?? usernames[0] ?? displays[0] ?? null;
  const identityField = emails[0] ? "email" : usernames[0] ? "username" : displays[0] ? "displayName" : null;
  if (identityField === "displayName") assumptions.push("Correlating on display name is weak: names are not unique. Prefer email or username if the system has one");
  if (!corrField) questions.push("No email, username or name field: how does an account find its person?");
  if (!entitlements.length) questions.push("No group or role field: where are entitlements listed?");

  const risk = classify(fields);
  if (risk.dataClassification === "restricted") evidence.push(`Restricted-looking fields: ${risk.sensitiveFields.join(", ")}`);
  const privileged = rank(fields, PRIVILEGED_NAMES)[0] ?? null;

  const destructiveActions: string[] = [];
  if (operations.deleteAccount.supported) destructiveActions.push(`Account deletion (${operations.deleteAccount.evidence}): irreversible; keep it off until deprovisioning is tested`);
  if (operations.revokeAccess.supported) destructiveActions.push(`Entitlement removal (${operations.revokeAccess.evidence})`);
  if (operations.disableAccount.supported) destructiveActions.push(`Account disabling (${operations.disableAccount.evidence})`);

  const suggestedTests = [
    identifier ? `Every imported account has a non-empty "${identifier}"` : "Find the account identifier and check every account has one",
    corrField ? `Accounts correlate to exactly one identity on "${corrField}"; count orphans and ambiguous matches` : "Correlation coverage once a matching field is chosen",
    ...(operations.createAccount.supported ? ["Create a test account and read it back"] : []),
    ...(operations.disableAccount.supported ? ["Disable the test account and confirm it cannot sign in"] : []),
    ...(operations.revokeAccess.supported ? ["Remove a group from the test account and confirm it is gone on the next import"] : []),
  ];

  const sections = [identifier ? 1 : 0, corrField ? 1 : 0, entitlements.length ? 1 : 0];
  const overallConfidence: Confidence = warnings.length ? "low" : sections.every(Boolean) && (identityField === "email" || identityField === "username") ? "high" : sections.filter(Boolean).length >= 2 ? "medium" : "low";
  if (warnings.length) assumptions.push("The input contains text addressed to an AI; confidence is lowered and nothing in it was followed");

  return {
    inputKind: kind,
    accountFields: fields.slice(0, 200),
    identifier: {
      field: identifier,
      candidates: idCandidates.slice(0, 10),
      confidence: identifier && /^(id|externalid|external_id)$/i.test(leaf(identifier)) ? "high" : identifier ? "medium" : "low",
    },
    correlation: { accountField: corrField, identityField, candidates: [...new Set([...emails, ...usernames, ...displays])].slice(0, 10), confidence: identityField === "email" ? "high" : identityField ? "medium" : "low" },
    entitlementField: { field: entitlements[0] ?? null, candidates: entitlements.slice(0, 10), confidence: conf(entitlements.length, true) },
    lastUsedField: rank(fields, LAST_USED_NAMES)[0] ?? null,
    statusField: rank(fields, STATUS_NAMES)[0] ?? null,
    privilegedField: privileged,
    operations,
    risk,
    // Sensitive data or admin flags → both manager and owner approve; else the owner.
    requestPolicy: risk.dataClassification === "restricted" || privileged ? "manager_and_owner" : risk.dataClassification === "confidential" ? "owner_approval" : "manager_approval",
    certificationPolicy: risk.dataClassification === "restricted" || privileged ? "quarterly" : risk.dataClassification === "confidential" ? "semiannual" : "annual",
    assumptions,
    evidence,
    unresolvedQuestions: questions,
    destructiveActions,
    suggestedTests,
    warnings,
    overallConfidence,
  };
}

// ---------------------------------------------------------------- AI refinement (validated)

export type AiRefinement = {
  identifierField?: unknown;
  correlationField?: unknown;
  entitlementField?: unknown;
  assumptions?: unknown;
  unresolvedQuestions?: unknown;
};

const strings = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300)).slice(0, max) : [];

/**
 * Applies a model's refinement only where it is valid: a field choice must
 * be one of the deterministic candidates (anything else is dropped as a
 * hallucination), and its notes become labelled assumptions and questions.
 * It can never add an operation, change a policy, or touch risk.
 */
export function refineWithAi(base: OnboardingProposal, ai: AiRefinement): { proposal: OnboardingProposal; accepted: string[]; rejected: string[] } {
  const p: OnboardingProposal = structuredClone(base);
  const accepted: string[] = [];
  const rejected: string[] = [];
  const choose = (label: string, value: unknown, candidates: string[], apply: (v: string) => void) => {
    if (value === undefined || value === null || value === "") return;
    if (typeof value === "string" && candidates.includes(value)) {
      apply(value);
      accepted.push(`${label}: ${value}`);
    } else rejected.push(`${label}: ${String(value).slice(0, 80)} (not a field in the input)`);
  };
  choose("identifier", ai.identifierField, base.identifier.candidates, (v) => (p.identifier.field = v));
  choose("correlation", ai.correlationField, base.correlation.candidates, (v) => {
    p.correlation.accountField = v;
    const l = leaf(v).replace(/[-_]/g, "");
    p.correlation.identityField = EMAIL_NAMES.includes(l) ? "email" : USERNAME_NAMES.includes(l) ? "username" : "displayName";
  });
  choose("entitlements", ai.entitlementField, base.entitlementField.candidates, (v) => (p.entitlementField.field = v));
  p.assumptions.push(...strings(ai.assumptions, 5).map((s) => `AI: ${s}`));
  p.unresolvedQuestions.push(...strings(ai.unresolvedQuestions, 5).map((s) => `AI: ${s}`));
  return { proposal: p, accepted, rejected };
}

/** What applying a proposal writes into an onboarding draft (never operations: those need the connector to declare them). */
export function proposalToOnboardingConfig(p: OnboardingProposal): Record<string, unknown> {
  return {
    ...(p.identifier.field ? { accountIdentifierField: p.identifier.field } : {}),
    ...(p.correlation.accountField && p.correlation.identityField ? { correlationAccountField: p.correlation.accountField, correlationIdentityField: p.correlation.identityField } : {}),
    requestPolicy: p.requestPolicy,
    certificationPolicy: p.certificationPolicy,
  };
}
