import { createHash } from "node:crypto";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * ACCESS-P0-16 — application onboarding, pure (#9): the configuration and
 * its hash, the spec §8.5 checklist, what a simulation found, and which
 * stage may follow which. The service does the I/O.
 */

const fail = (message: string): never => {
  throw new ApiError(400, "VALIDATION_FAILED", message);
};

export const ONBOARDING_OPERATIONS = ["createAccount", "updateAccount", "disableAccount", "deleteAccount", "grantAccess", "revokeAccess"] as const;
export type OnboardingOperation = (typeof ONBOARDING_OPERATIONS)[number];
export const REQUEST_POLICIES = ["not_requestable", "manager_approval", "owner_approval", "manager_and_owner"] as const;
export const CERTIFICATION_POLICIES = ["none", "quarterly", "semiannual", "annual"] as const;
export const CORRELATION_IDENTITY_FIELDS = ["email", "username", "displayName"] as const;

export type OnboardingConfig = {
  integrationId: string | null;
  accountIdentifierField: string | null;
  correlation: { accountField: string; identityField: (typeof CORRELATION_IDENTITY_FIELDS)[number] } | null;
  entitlementSource: "connector" | "manual" | null;
  operations: Record<OnboardingOperation, boolean>;
  requestPolicy: (typeof REQUEST_POLICIES)[number] | null;
  certificationPolicy: (typeof CERTIFICATION_POLICIES)[number] | null;
  provenanceEnabled: boolean;
};

export const EMPTY_CONFIG: OnboardingConfig = {
  integrationId: null,
  accountIdentifierField: null,
  correlation: null,
  entitlementSource: null,
  operations: { createAccount: false, updateAccount: false, disableAccount: false, deleteAccount: false, grantAccess: false, revokeAccess: false },
  requestPolicy: null,
  certificationPolicy: null,
  provenanceEnabled: true,
};

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const flag = (v: unknown) => v === true || v === "true" || v === "on";

function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) return fail(`${field}: one of ${allowed.join(", ")}`);
  return v as T;
}

/** Validates a (partial) configuration and merges it onto the current one. */
export function validateOnboardingConfig(input: Record<string, unknown>, current: OnboardingConfig = EMPTY_CONFIG): OnboardingConfig {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const next: OnboardingConfig = { ...current, operations: { ...current.operations } };
  if (has("integrationId")) {
    const v = input.integrationId;
    if (v === null || v === "") next.integrationId = null;
    else if (typeof v !== "string" || !UUID_RE.test(v)) fail("integrationId: an integration id");
    else next.integrationId = v;
  }
  if (has("accountIdentifierField")) {
    const v = typeof input.accountIdentifierField === "string" ? input.accountIdentifierField.trim() : "";
    if (v && !FIELD_RE.test(v)) fail("accountIdentifierField: a field name or dotted path");
    next.accountIdentifierField = v || null;
  }
  if (has("correlationAccountField") || has("correlationIdentityField")) {
    const accountField = typeof input.correlationAccountField === "string" ? input.correlationAccountField.trim() : next.correlation?.accountField ?? "";
    const identityField = oneOf(input.correlationIdentityField ?? next.correlation?.identityField, "correlationIdentityField", CORRELATION_IDENTITY_FIELDS);
    if (accountField && !FIELD_RE.test(accountField)) fail("correlationAccountField: a field name or dotted path");
    next.correlation = accountField && identityField ? { accountField, identityField } : null;
  }
  if (has("entitlementSource")) next.entitlementSource = oneOf(input.entitlementSource, "entitlementSource", ["connector", "manual"] as const);
  for (const op of ONBOARDING_OPERATIONS) if (has(op)) next.operations[op] = flag(input[op]);
  if (has("requestPolicy")) next.requestPolicy = oneOf(input.requestPolicy, "requestPolicy", REQUEST_POLICIES);
  if (has("certificationPolicy")) next.certificationPolicy = oneOf(input.certificationPolicy, "certificationPolicy", CERTIFICATION_POLICIES);
  if (has("provenanceEnabled")) next.provenanceEnabled = flag(input.provenanceEnabled);
  if (next.entitlementSource === "connector" && !next.integrationId) fail("entitlementSource: entitlements from the connector need an integration");
  return next;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** A stable hash of a configuration: key order never matters. */
export function configHash(config: OnboardingConfig): string {
  return createHash("sha256").update(JSON.stringify(canonical(config))).digest("hex");
}

// ---------------------------------------------------------------- checklist

export type ChecklistState = "pass" | "fail" | "not_applicable";
export type ChecklistItem = { key: string; label: string; state: ChecklistState; blocking: boolean; detail: string };

export type ChecklistContext = {
  config: OnboardingConfig;
  app: { businessOwnerIdentityId: string | null; technicalOwnerIdentityId: string | null; riskLevel: string | null; dataClassification: string | null };
  /** The linked integration, or null when not connected. */
  integration: { capabilities: Record<string, boolean | undefined>; lastSyncStatus: string | null } | null;
  entitlementCount: number;
};

const OPERATION_ITEMS: { key: string; label: string; ops: OnboardingOperation[] }[] = [
  { key: "create_account", label: "Account create operation validated", ops: ["createAccount"] },
  { key: "update_account", label: "Account update operation validated", ops: ["updateAccount"] },
  { key: "disable_delete_account", label: "Disable/delete operation validated", ops: ["disableAccount", "deleteAccount"] },
  { key: "grant_access", label: "Entitlement grant validated", ops: ["grantAccess"] },
  { key: "revoke_access", label: "Entitlement revoke validated", ops: ["revokeAccess"] },
];

/**
 * The spec §8.5 minimum checklist. Blocking items stop promotion; the six
 * operations decide only whether the application is "automation ready"
 * (spec §8.6: a failed deprovision is not automation ready), since an
 * application can be governed with manual fulfilment.
 */
export function evaluateChecklist(ctx: ChecklistContext): { items: ChecklistItem[]; blockingFailures: string[]; automationReady: boolean } {
  const { config, app, integration } = ctx;
  const item = (key: string, label: string, ok: boolean | null, blocking: boolean, pass: string, failure: string): ChecklistItem => ({
    key,
    label,
    state: ok === null ? "not_applicable" : ok ? "pass" : "fail",
    blocking: blocking && ok !== null,
    detail: ok === null ? "Not applicable" : ok ? pass : failure,
  });
  const items: ChecklistItem[] = [
    item("account_schema", "Identity/account schema validated", Boolean(config.accountIdentifierField), true, `Accounts are identified by ${config.accountIdentifierField}`, "Name the field that uniquely identifies an account"),
    item("account_correlation", "Account correlation configured", Boolean(config.correlation), true, config.correlation ? `${config.correlation.accountField} → identity ${config.correlation.identityField}` : "", "Say how an account finds its identity"),
    item("entitlement_model", "Entitlement model discovered", ctx.entitlementCount > 0, true, `${ctx.entitlementCount} entitlement${ctx.entitlementCount === 1 ? "" : "s"}`, config.entitlementSource === "connector" ? "Sync the integration to import entitlements" : "Add the application's entitlements"),
    // Spec §8.5 lists disable and delete as one item; they are checked together.
    ...OPERATION_ITEMS.map(({ key, label, ops }) => {
      const wanted = ops.filter((op) => config.operations[op]);
      return item(
        key,
        label,
        wanted.length === 0 ? null : wanted.every((op) => Boolean(integration?.capabilities[op])),
        false,
        "The connector declares it",
        integration ? "The connector does not declare it; it will be fulfilled by hand" : "Not connected; it will be fulfilled by hand",
      );
    }),
    item(
      "reconciliation",
      "Reconciliation validated",
      integration ? integration.lastSyncStatus === "succeeded" : null,
      true,
      "The latest sync succeeded",
      integration?.lastSyncStatus ? `The latest sync ${integration.lastSyncStatus === "partial" ? "was partial" : integration.lastSyncStatus}` : "Run a sync of the integration",
    ),
    item("owner", "Owner assigned", Boolean(app.businessOwnerIdentityId && app.technicalOwnerIdentityId), true, "Business and technical owners set", "Set both owners in the catalog"),
    item("risk", "Risk classified", Boolean(app.riskLevel && app.dataClassification), true, "Risk and data classification set", "Set risk level and data classification in the catalog"),
    item("access_model", "Access model configured", Boolean(config.entitlementSource), true, `Entitlements from ${config.entitlementSource === "connector" ? "the connector" : "manual entry"}`, "Choose where entitlements come from"),
    item("request_policy", "Request policy configured", Boolean(config.requestPolicy), true, (config.requestPolicy ?? "").replace(/_/g, " "), "Choose how access is requested"),
    item("certification_policy", "Certification policy configured", Boolean(config.certificationPolicy), true, config.certificationPolicy ?? "", "Choose how often access is reviewed"),
    item("provenance", "Audit/provenance enabled", config.provenanceEnabled, true, "Every change is audited with its source", "Audit and provenance must stay on"),
  ];
  const blockingFailures = items.filter((i) => i.blocking && i.state === "fail").map((i) => i.key);
  // Automation ready: every operation wanted and declared by the connector.
  const automationReady = Boolean(integration) && ONBOARDING_OPERATIONS.every((op) => config.operations[op] && integration?.capabilities[op] === true);
  return { items, blockingFailures, automationReady };
}

// ---------------------------------------------------------------- simulation

export type SimulationResult = {
  accounts: number;
  correlated: number;
  unmatched: number;
  ambiguous: number;
  missingIdentifier: number;
  entitlements: number;
  passed: boolean;
  problems: string[];
  sample: { accountId: string; outcome: "correlated" | "unmatched" | "ambiguous" | "missing_identifier" }[];
};

function read(raw: Record<string, unknown>, path: string): unknown {
  if (path in raw) return raw[path];
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), raw);
}

/**
 * What promotion would do with the accounts the connector already
 * imported: how many correlate to exactly one identity, how many would be
 * orphans, how many are ambiguous, and whether any lack the required
 * identifier (which fails the simulation: spec §8.6). Reads only.
 */
export function simulateOnboarding(
  config: OnboardingConfig,
  accounts: Record<string, unknown>[],
  identities: { id: string; email: string | null; username: string | null; displayName: string }[],
  entitlements: number,
): SimulationResult {
  const result: SimulationResult = { accounts: accounts.length, correlated: 0, unmatched: 0, ambiguous: 0, missingIdentifier: 0, entitlements, passed: true, problems: [], sample: [] };
  const byField = new Map<string, string[]>();
  if (config.correlation) {
    for (const i of identities) {
      const v = (i[config.correlation.identityField] ?? "").toString().trim().toLowerCase();
      if (v) byField.set(v, [...(byField.get(v) ?? []), i.id]);
    }
  }
  for (const a of accounts) {
    const idRaw = config.accountIdentifierField ? read(a, config.accountIdentifierField) : undefined;
    const accountId = idRaw === undefined || idRaw === null ? "" : String(idRaw).trim();
    let outcome: SimulationResult["sample"][number]["outcome"];
    if (!accountId) {
      result.missingIdentifier++;
      outcome = "missing_identifier";
    } else {
      const key = config.correlation ? String(read(a, config.correlation.accountField) ?? "").trim().toLowerCase() : "";
      const matches = key ? (byField.get(key) ?? []) : [];
      if (matches.length === 1) {
        result.correlated++;
        outcome = "correlated";
      } else if (matches.length > 1) {
        result.ambiguous++;
        outcome = "ambiguous";
      } else {
        result.unmatched++;
        outcome = "unmatched";
      }
    }
    if (result.sample.length < 25) result.sample.push({ accountId: accountId || "(none)", outcome });
  }
  if (!config.accountIdentifierField) result.problems.push("No account identifier is configured");
  if (result.missingIdentifier) result.problems.push(`${result.missingIdentifier} account(s) have no ${config.accountIdentifierField ?? "identifier"}`);
  result.passed = result.problems.length === 0;
  return result;
}

// ---------------------------------------------------------------- stages

export type OnboardingStatus =
  | "DRAFT"
  | "CONFIGURING"
  | "VALIDATING"
  | "SIMULATING"
  | "WAITING_FOR_APPROVAL"
  | "APPROVED"
  | "PROMOTED"
  | "FAILED"
  | "REJECTED"
  | "ARCHIVED";

export type OnboardingState = {
  status: OnboardingStatus;
  configHash: string;
  validatedHash: string | null;
  validationPassed: boolean;
  simulatedHash: string | null;
  simulationPassed: boolean;
  submittedBy: string | null;
  approvedHash: string | null;
};

const CLOSED = new Set<OnboardingStatus>(["PROMOTED", "ARCHIVED"]);

/** Why an action is not allowed now, or null when it is. */
export function blockReason(action: "configure" | "validate" | "simulate" | "approve" | "reject" | "promote", s: OnboardingState, actorId: string): string | null {
  if (CLOSED.has(s.status) && action !== "configure") return `Onboarding is ${s.status.toLowerCase()}`;
  switch (action) {
    case "configure":
      return s.status === "ARCHIVED" ? "Onboarding is archived" : null;
    case "validate":
      return null;
    case "simulate":
      if (s.validatedHash !== s.configHash || !s.validationPassed) return "Validate the current configuration first";
      return null;
    case "approve":
    case "reject":
      if (s.status !== "WAITING_FOR_APPROVAL") return "Nothing is waiting for approval";
      if (s.simulatedHash !== s.configHash || s.validatedHash !== s.configHash) return "The configuration changed after it was submitted";
      if (action === "approve" && s.submittedBy === actorId) return "Someone other than the submitter must approve";
      return null;
    case "promote":
      if (s.status !== "APPROVED") return "Only an approved configuration can be promoted";
      if (s.approvedHash !== s.configHash) return "The configuration changed after approval; it needs validating and approving again";
      return null;
  }
}
