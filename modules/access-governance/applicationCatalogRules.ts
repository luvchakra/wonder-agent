import { ApiError } from "@/lib/shared/types/foundation";
import {
  APPLICATION_ENVIRONMENTS,
  APPLICATION_TYPES,
  CATALOG_LEVELS,
  DATA_CLASSIFICATION_LEVELS,
} from "@/lib/shared/types/access-governance";

/**
 * ACCESS-P0-15 — validation of catalog fields, pure (#9). Returns the
 * database columns to write. With `partial`, only the keys present are
 * validated and returned (an update); without it, a name is required (a
 * registration). Owners are checked against identities by the service.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string): never => {
  throw new ApiError(400, "VALIDATION_FAILED", message);
};

export type ApplicationInput = Record<string, unknown>;

function text(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return fail(`${field}: must be text`);
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) fail(`${field}: at most ${max} characters`);
  return t;
}

function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[], nullable: boolean): T | null {
  if (v === undefined || v === null || v === "") return nullable ? null : fail(`${field}: required`);
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) return fail(`${field}: one of ${allowed.join(", ")}`);
  return v as T;
}

export function validateApplicationInput(input: ApplicationInput, opts: { partial: boolean }): Record<string, unknown> {
  const has = (k: string) => !opts.partial || Object.prototype.hasOwnProperty.call(input, k);
  const row: Record<string, unknown> = {};
  if (has("name")) {
    const name = text(input.name, "name", 200);
    if (!name) fail("name: required");
    row.name = name;
  }
  if (has("displayName")) row.display_name = text(input.displayName, "displayName", 200);
  if (has("description")) row.description = text(input.description, "description", 2000);
  if (has("category")) row.category = text(input.category, "category", 100);
  if (has("appType")) row.app_type = oneOf(input.appType ?? (opts.partial ? undefined : "other"), "appType", APPLICATION_TYPES, false);
  if (has("vendor")) row.vendor = text(input.vendor, "vendor", 200);
  if (has("url")) {
    const url = text(input.url, "url", 500);
    if (url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return fail("url: not a valid address");
      }
      if (parsed.protocol !== "https:") fail("url: must start with https://");
    }
    row.url = url;
  }
  for (const [key, column] of [
    ["businessOwnerIdentityId", "business_owner_identity_id"],
    ["technicalOwnerIdentityId", "technical_owner_identity_id"],
  ] as const) {
    if (!has(key)) continue;
    const v = text(input[key], key, 36);
    if (v && !UUID_RE.test(v)) fail(`${key}: must be an identity id`);
    row[column] = v;
  }
  if (has("environment")) row.environment = oneOf(input.environment ?? (opts.partial ? undefined : "production"), "environment", APPLICATION_ENVIRONMENTS, false);
  if (has("riskLevel")) row.risk_level = oneOf(input.riskLevel, "riskLevel", CATALOG_LEVELS, true);
  if (has("criticality")) row.criticality = oneOf(input.criticality, "criticality", CATALOG_LEVELS, true);
  if (has("dataClassification")) row.data_classification = oneOf(input.dataClassification, "dataClassification", DATA_CLASSIFICATION_LEVELS, true);
  if (has("isExternal")) row.is_external = input.isExternal === true || input.isExternal === "true" || input.isExternal === "on";
  // Never accepted from input: tenant, onboarding status (ACCESS-P0-16's
  // governed transitions), discovery source and the integration link.
  return row;
}
