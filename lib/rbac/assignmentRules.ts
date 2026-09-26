import { ENVIRONMENTS, SCOPE_TYPES, type ScopeType } from "./authorizeCore";

/**
 * FOUNDATION-P0-19 — the terms of a role assignment (spec §18–20): where it
 * applies (scope), when (start, expiry) and under what condition (MFA).
 * Pure validation; migration 0100 enforces the same rules again.
 */

export type AssignmentTerms = {
  scopeType: ScopeType;
  scopeValues: string[];
  startsAt: string | null;
  expiresAt: string | null;
  requiresMfa: boolean;
};

export const TENANT_WIDE: AssignmentTerms = { scopeType: "tenant", scopeValues: [], startsAt: null, expiresAt: null, requiresMfa: false };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function when(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const t = Date.parse(v);
  return Number.isNaN(t) ? "invalid" : new Date(t).toISOString();
}

export function validateTerms(
  input: { scopeType?: unknown; scopeValues?: unknown; startsAt?: unknown; expiresAt?: unknown; requiresMfa?: unknown },
  role: string,
  now: Date,
): { ok: true; terms: AssignmentTerms } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const scopeType = (input.scopeType ?? "tenant") as ScopeType;
  if (!(SCOPE_TYPES as readonly string[]).includes(scopeType)) errors.scopeType = "Choose where the role applies.";
  const raw = Array.isArray(input.scopeValues) ? input.scopeValues : typeof input.scopeValues === "string" && input.scopeValues ? [input.scopeValues] : [];
  const scopeValues = [...new Set(raw.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()))];
  if (scopeType === "tenant") {
    if (scopeValues.length) errors.scopeValues = "An organization-wide assignment names no environments, applications or agents.";
  } else if (!scopeValues.length) {
    errors.scopeValues = scopeType === "environment" ? "Choose at least one environment." : scopeType === "application" ? "Choose at least one application." : "Choose at least one agent.";
  } else if (scopeValues.length > 50) {
    errors.scopeValues = "At most 50.";
  } else if (scopeType === "environment" && scopeValues.some((v) => !(ENVIRONMENTS as readonly string[]).includes(v))) {
    errors.scopeValues = "Unknown environment.";
  } else if (scopeType !== "environment" && scopeValues.some((v) => !UUID_RE.test(v))) {
    errors.scopeValues = "Unknown application or agent.";
  }
  const startsAt = when(input.startsAt);
  const expiresAt = when(input.expiresAt);
  if (startsAt === "invalid") errors.startsAt = "Not a valid date.";
  if (expiresAt === "invalid") errors.expiresAt = "Not a valid date.";
  if (expiresAt && expiresAt !== "invalid") {
    if (Date.parse(expiresAt) <= now.getTime()) errors.expiresAt = "The expiry must be in the future.";
    else if (startsAt && startsAt !== "invalid" && Date.parse(startsAt) >= Date.parse(expiresAt)) errors.expiresAt = "The expiry must be after the start.";
  }
  const requiresMfa = input.requiresMfa === true || input.requiresMfa === "on" || input.requiresMfa === "true";
  if (role === "TENANT_SUPER_ADMIN" && (scopeType !== "tenant" || startsAt || expiresAt || requiresMfa)) {
    errors.scopeType = "The Tenant Administrator role is always organization-wide, permanent and unconditional.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, terms: { scopeType, scopeValues, startsAt: startsAt as string | null, expiresAt: expiresAt as string | null, requiresMfa } };
}

export function termsToRow(t: AssignmentTerms) {
  return { scope_type: t.scopeType, scope_values: t.scopeValues, starts_at: t.startsAt, expires_at: t.expiresAt, requires_mfa: t.requiresMfa };
}

export function isTenantWide(t: AssignmentTerms): boolean {
  return t.scopeType === "tenant" && !t.startsAt && !t.expiresAt && !t.requiresMfa;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * How an assignment's terms read on screen, e.g. "Environment: production ·
 * until 31 Dec 2026 · MFA". `label` turns application and agent ids into names.
 */
export function describeTerms(t: AssignmentTerms, label: (id: string) => string = (id) => id): string {
  const parts = [t.scopeType === "tenant" ? "Entire organization" : describeScopeOf(t, label)];
  if (t.startsAt) parts.push(`from ${day(t.startsAt)}`);
  if (t.expiresAt) parts.push(`until ${day(t.expiresAt)}`);
  if (t.requiresMfa) parts.push("MFA");
  return parts.join(" · ");
}

function describeScopeOf(t: AssignmentTerms, label: (id: string) => string): string {
  const kind = t.scopeType === "environment" ? "Environment" : t.scopeType === "application" ? "Applications" : "Agents";
  return `${kind}: ${t.scopeValues.map((v) => (t.scopeType === "environment" ? v : label(v))).join(", ")}`;
}

/** Whether the assignment is in effect at `now` (inside its validity window). */
export function termsCurrent(t: Pick<AssignmentTerms, "startsAt" | "expiresAt">, now: Date): boolean {
  return (!t.startsAt || Date.parse(t.startsAt) <= now.getTime()) && (!t.expiresAt || Date.parse(t.expiresAt) > now.getTime());
}
