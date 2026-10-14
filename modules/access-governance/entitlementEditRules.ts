import { optionalText, STATUSES, typeName } from "./entitlementTypeRules";

/**
 * Owner feedback 2026-10-14 — editing, disabling and deleting an
 * entitlement, pure (#9). A connector's entitlement keeps its name (the
 * source is the system of record, #7) and is disabled rather than deleted;
 * one ever granted is disabled too, so its access history stays.
 */

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
const PRIVILEGE_LEVELS = ["standard", "elevated", "admin"] as const;

export type EntitlementEditInput = {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  entitlementType?: unknown;
  privilegeLevel?: unknown;
  dataClassification?: unknown;
  riskLevel?: unknown;
  requestable?: unknown;
  certifiable?: unknown;
  soxRelevant?: unknown;
  status?: unknown;
};

export function validateEntitlementEdit(input: EntitlementEditInput, current: { fromConnector: boolean }): { set: Record<string, unknown>; typeName?: string | null } | { error: string } {
  const set: Record<string, unknown> = {};
  let type: string | null | undefined;
  if (input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 200) return { error: "name: at most 200 characters" };
    if (current.fromConnector) return { error: "name: an entitlement from a connector keeps the source's name" };
    set.name = name;
  }
  for (const [key, col, max] of [
    ["displayName", "display_name", 200],
    ["description", "description", 2000],
    ["dataClassification", "data_classification", 100],
  ] as const) {
    if (input[key] === undefined) continue;
    const t = optionalText(input[key], key, max);
    if (t !== null && typeof t === "object") return t;
    set[col] = t;
  }
  if (input.entitlementType !== undefined) {
    type = input.entitlementType === null || input.entitlementType === "" ? null : typeName(input.entitlementType);
    if (input.entitlementType && !type) return { error: "entitlementType: a type name, or empty" };
  }
  if (input.privilegeLevel !== undefined) {
    if (!PRIVILEGE_LEVELS.includes(input.privilegeLevel as "standard")) return { error: "privilegeLevel: standard, elevated or admin" };
    set.privilege_level = input.privilegeLevel;
  }
  if (input.riskLevel !== undefined) {
    if (input.riskLevel !== null && input.riskLevel !== "" && !RISK_LEVELS.includes(input.riskLevel as "low")) return { error: "riskLevel: low, medium, high, critical, or empty" };
    set.risk_level = input.riskLevel || null;
  }
  for (const [key, col] of [
    ["requestable", "requestable"],
    ["certifiable", "certifiable"],
    ["soxRelevant", "sox_relevant"],
  ] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") return { error: `${key}: true or false` };
    set[col] = input[key];
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status as "active")) return { error: "status: active or inactive" };
    set.status = input.status;
  }
  if (!Object.keys(set).length && type === undefined) return { error: "Nothing to change" };
  return type === undefined ? { set } : { set, typeName: type };
}

/** Why an entitlement cannot be deleted (disable it instead), or null. */
export function entitlementDeleteRefusal(e: { fromConnector: boolean; grants: number }): { code: string; message: string } | null {
  if (e.fromConnector) return { code: "FROM_CONNECTOR", message: "It comes from a connector; disable it instead" };
  if (e.grants > 0) return { code: "IN_USE", message: "It has been granted; disable it instead, so its history stays" };
  return null;
}

/** Why an entitlement type cannot be deleted (disable it instead), or null. */
export function typeDeleteRefusal(t: { entitlements: number }): { code: string; message: string } | null {
  return t.entitlements > 0 ? { code: "IN_USE", message: "Entitlements still have this type; move or delete them, or disable the type" } : null;
}
