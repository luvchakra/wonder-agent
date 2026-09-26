import { ApiError } from "@/lib/shared/types/foundation";
import { APPROVAL_MODES, APPROVAL_ROUTES, ON_TIMEOUT, RISK_LEVELS, type RiskLevel } from "./requestRules";

/**
 * ACCESS-P0-20 — access package rules, pure (#9): who a package is for
 * (eligibility decides discoverability and requests), how risky it is (the
 * worst of what it includes), what an assignment's state is from its work
 * items, and when it ends. The service (`packages.ts`) does the I/O.
 */

export const PACKAGE_IDENTITY_TYPES = ["HUMAN", "EXTERNAL", "MACHINE", "AI_AGENT"] as const;
export type PackageIdentityType = (typeof PACKAGE_IDENTITY_TYPES)[number];
export const CERTIFICATION_FREQUENCIES = ["none", "quarterly", "semiannual", "annual"] as const;
export const PACKAGE_STATUSES = ["draft", "active", "retired"] as const;

export type PackageEligibility = { eligibleIdentityTypes: string[]; eligibleDepartments: string[] };
export type EligibilitySubject = { identityType: string; department: string | null; status: string };

/** Whether a package is for this identity, and every reason it is not. */
export function checkEligibility(pkg: PackageEligibility, subject: EligibilitySubject): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (subject.status !== "active") reasons.push("The identity is not active");
  if (!pkg.eligibleIdentityTypes.includes(subject.identityType)) reasons.push(`It is for ${pkg.eligibleIdentityTypes.map(typeLabel).join(", ")} identities only`);
  if (pkg.eligibleDepartments.length) {
    // Exact (trimmed) match, the same comparison the catalog query makes, so paging and explanation agree.
    const dept = (subject.department ?? "").trim();
    if (!pkg.eligibleDepartments.some((d) => d.trim() === dept)) reasons.push(`It is for the ${pkg.eligibleDepartments.join(", ")} department${pkg.eligibleDepartments.length === 1 ? "" : "s"} only`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function typeLabel(t: string): string {
  return t === "HUMAN" ? "people" : t === "EXTERNAL" ? "external" : t === "MACHINE" ? "machine" : t === "AI_AGENT" ? "AI agent" : t.toLowerCase();
}

const rank = (r: RiskLevel) => RISK_LEVELS.indexOf(r);
/** A package is as risky as the riskiest thing it includes (low when empty). */
export function packageRisk(itemRisks: RiskLevel[]): RiskLevel {
  return itemRisks.reduce<RiskLevel>((a, b) => (rank(b) > rank(a) ? b : a), "low");
}

export type ItemStatus = "pending" | "fulfilled" | "failed" | "revoke_pending" | "revoked";
export type AssignmentStatus = "provisioning" | "active" | "partially_failed" | "expired" | "revoked";

/**
 * A live assignment's state from its items: any failure shows (partially
 * failed, never hidden); all fulfilled is active; otherwise it is still
 * provisioning. An ended assignment keeps its end state.
 */
export function assignmentStatus(current: AssignmentStatus, items: ItemStatus[]): AssignmentStatus {
  if (current === "expired" || current === "revoked") return current;
  if (items.some((s) => s === "failed")) return "partially_failed";
  if (items.length && items.every((s) => s === "fulfilled")) return "active";
  return "provisioning";
}

/** What ending an assignment does to each item: fulfilled access becomes revocation work; the rest is closed. */
export function itemOnEnd(status: ItemStatus): ItemStatus {
  return status === "fulfilled" || status === "revoke_pending" ? "revoke_pending" : "revoked";
}

/** When a new assignment ends: the requested expiry, else the package default, else never. */
export function assignmentExpiry(now: Date, requestedDays: number | null, pkg: { defaultDurationDays: number | null; maxDurationDays: number | null }): { days: number | null; expiresAt: string | null } {
  const days = requestedDays ?? pkg.defaultDurationDays ?? pkg.maxDurationDays ?? null;
  if (days !== null && pkg.maxDurationDays !== null && days > pkg.maxDurationDays) throw new ApiError(400, "DURATION_TOO_LONG", `At most ${pkg.maxDurationDays} days for this package`);
  return { days, expiresAt: days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString() };
}

export type PackageFields = Record<string, unknown>;

/** Validates a package's fields; `partial` for an update. Returns database columns. */
export function validatePackageInput(input: Record<string, unknown>, partial: boolean): PackageFields {
  const out: PackageFields = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  const fail = (m: string): never => {
    throw new ApiError(400, "VALIDATION_FAILED", m);
  };
  const oneOf = (k: string, col: string, values: readonly string[]) => {
    if (!has(k)) return;
    if (!values.includes(input[k] as string)) fail(`${k}: one of ${values.join(", ")}`);
    out[col] = input[k];
  };
  if (!partial || has("name")) {
    const n = typeof input.name === "string" ? input.name.trim() : "";
    if (!n || n.length > 200) fail("name: 1 to 200 characters");
    out.name = n;
  }
  if (has("description")) {
    const d = input.description === null ? "" : String(input.description).trim();
    if (d.length > 2000) fail("description: at most 2000 characters");
    out.description = d || null;
  }
  if (has("requestable")) out.requestable = input.requestable === true || input.requestable === "true" || input.requestable === "on";
  if (has("extensionAllowed")) out.extension_allowed = input.extensionAllowed === true || input.extensionAllowed === "true" || input.extensionAllowed === "on";
  if (has("eligibleIdentityTypes")) {
    const types = Array.isArray(input.eligibleIdentityTypes) ? input.eligibleIdentityTypes : [];
    if (!types.length || types.some((t) => !(PACKAGE_IDENTITY_TYPES as readonly unknown[]).includes(t))) fail(`eligibleIdentityTypes: one or more of ${PACKAGE_IDENTITY_TYPES.join(", ")}`);
    out.eligible_identity_types = [...new Set(types as string[])];
  }
  if (has("eligibleDepartments")) {
    const raw = Array.isArray(input.eligibleDepartments) ? input.eligibleDepartments : typeof input.eligibleDepartments === "string" ? input.eligibleDepartments.split(",") : [];
    const depts = [...new Set(raw.map((d) => String(d).trim()).filter(Boolean))];
    if (depts.length > 50 || depts.some((d) => d.length > 100)) fail("eligibleDepartments: at most 50 names of up to 100 characters");
    out.eligible_departments = depts;
  }
  oneOf("approval", "approval", APPROVAL_ROUTES);
  oneOf("approvalMode", "approval_mode", APPROVAL_MODES);
  oneOf("onTimeout", "on_timeout", ON_TIMEOUT);
  oneOf("certificationFrequency", "certification_frequency", CERTIFICATION_FREQUENCIES);
  if (has("approvalTimeoutDays")) {
    const n = Number(input.approvalTimeoutDays);
    if (!Number.isInteger(n) || n < 1 || n > 60) fail("approvalTimeoutDays: 1 to 60 days");
    out.approval_timeout_days = n;
  }
  for (const [k, col] of [
    ["maxDurationDays", "max_duration_days"],
    ["defaultDurationDays", "default_duration_days"],
  ] as const) {
    if (!has(k)) continue;
    const v = input[k];
    if (v === null || v === "") {
      out[col] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 3650) fail(`${k}: 1 to 3650 days, or empty`);
    out[col] = n;
  }
  if (typeof out.max_duration_days === "number" && typeof out.default_duration_days === "number" && out.default_duration_days > out.max_duration_days) {
    fail("defaultDurationDays: cannot exceed the maximum");
  }
  return out;
}

/** A stable digest of what a package includes, for the approval fingerprint: changing the contents needs approval again. */
export function contentsDigest(resources: { applicationId: string; entitlementId: string | null; privilegeLevel: string | null }[]): string {
  return resources
    .map((r) => `${r.applicationId}:${r.entitlementId ?? "*"}:${r.privilegeLevel ?? "-"}`)
    .sort()
    .join("|");
}
