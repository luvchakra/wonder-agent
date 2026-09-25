import { ApiError } from "@/lib/shared/types/foundation";
import {
  ATTRIBUTE_DATA_TYPES,
  IDENTITY_RELATIONSHIP_TYPES,
  IDENTITY_STATUSES,
  IDENTITY_TYPES,
  MACHINE_IDENTITY_TYPES,
  MANUAL_IDENTITY_TYPES,
  type AttributeDataType,
  type IdentityAttributeDefinition,
  type IdentityRelationshipType,
  type IdentityStatus,
  type IdentityType,
} from "@/lib/shared/types/agent-identity";

/**
 * IDENTITY-P0-15/16 — the deterministic rules an identity must satisfy,
 * kept pure so each is unit-tested on its own (#9). The service applies
 * them before any write; the database's checks and same-tenant foreign
 * keys stay underneath.
 */

export type IdentityInput = {
  identityType?: unknown;
  subtype?: unknown;
  displayName?: unknown;
  username?: unknown;
  email?: unknown;
  status?: unknown;
  ownerIdentityId?: unknown;
  sponsorIdentityId?: unknown;
  managerIdentityId?: unknown;
  department?: unknown;
  title?: unknown;
  businessUnit?: unknown;
  location?: unknown;
  employmentType?: unknown;
  organization?: unknown;
  purpose?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  privileged?: unknown;
  attributes?: unknown;
};

export type ValidIdentityFields = {
  identityType: IdentityType;
  subtype: string | null;
  displayName: string;
  username: string | null;
  email: string | null;
  status: IdentityStatus;
  ownerIdentityId: string | null;
  sponsorIdentityId: string | null;
  managerIdentityId: string | null;
  department: string | null;
  title: string | null;
  businessUnit: string | null;
  location: string | null;
  employmentType: string | null;
  organization: string | null;
  purpose: string | null;
  startDate: string | null;
  endDate: string | null;
  privileged: boolean;
  attributes: Record<string, unknown>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (message: string): never => {
  throw new ApiError(400, "VALIDATION_FAILED", message);
};

function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return fail(`${field}: must be text`);
  const v = value.trim();
  if (!v) return null;
  if (v.length > max) return fail(`${field}: at most ${max} characters`);
  return v;
}

function uuid(value: unknown, field: string): string | null {
  const v = text(value, field, 36);
  if (v && !UUID_RE.test(v)) return fail(`${field}: must be an identity id`);
  return v;
}

function date(value: unknown, field: string): string | null {
  const v = text(value, field, 10);
  if (v && (!DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) return fail(`${field}: must be a date (YYYY-MM-DD)`);
  return v;
}

/**
 * Validates a new identity created by hand. `today` is injected so the
 * external-expiry rule is testable.
 *
 * - AI agents are not created here: they are registered under AI Agents,
 *   and their identity row follows the agent.
 * - An external identity is time-bound and sponsored (spec §10.1): a
 *   sponsor, an organization and an end date in the future are required.
 * - A machine identity (service account, application, workload, API,
 *   machine) needs an accountable owner (spec §24.1).
 */
export function validateNewIdentity(input: IdentityInput, today: string): ValidIdentityFields {
  const identityType = input.identityType;
  if (identityType === "AI_AGENT") fail("identityType: register AI agents under AI Agents; their identity follows the agent");
  if (typeof identityType !== "string" || !(MANUAL_IDENTITY_TYPES as readonly string[]).includes(identityType)) {
    fail(`identityType: one of ${MANUAL_IDENTITY_TYPES.join(", ")}`);
  }
  const type = identityType as IdentityType;
  const displayName = text(input.displayName, "displayName", 200) ?? fail("displayName: required");
  const email = text(input.email, "email", 320);
  if (email && !EMAIL_RE.test(email)) fail("email: must be an email address");
  const status = input.status === undefined || input.status === null || input.status === "" ? "active" : input.status;
  if (typeof status !== "string" || !(IDENTITY_STATUSES as readonly string[]).includes(status)) fail(`status: one of ${IDENTITY_STATUSES.join(", ")}`);
  const startDate = date(input.startDate, "startDate");
  const endDate = date(input.endDate, "endDate");
  if (startDate && endDate && endDate < startDate) fail("endDate: must be on or after the start date");
  const fields: ValidIdentityFields = {
    identityType: type,
    subtype: text(input.subtype, "subtype", 60),
    displayName,
    username: text(input.username, "username", 200),
    email,
    status: status as IdentityStatus,
    ownerIdentityId: uuid(input.ownerIdentityId, "ownerIdentityId"),
    sponsorIdentityId: uuid(input.sponsorIdentityId, "sponsorIdentityId"),
    managerIdentityId: uuid(input.managerIdentityId, "managerIdentityId"),
    department: text(input.department, "department", 200),
    title: text(input.title, "title", 200),
    businessUnit: text(input.businessUnit, "businessUnit", 200),
    location: text(input.location, "location", 200),
    employmentType: text(input.employmentType, "employmentType", 60),
    organization: text(input.organization, "organization", 200),
    purpose: text(input.purpose, "purpose", 2000),
    startDate,
    endDate,
    privileged: input.privileged === true || input.privileged === "true" || input.privileged === "on",
    attributes: {},
  };

  if (type === "EXTERNAL") {
    if (!fields.sponsorIdentityId) fail("sponsorIdentityId: an external identity needs a sponsor");
    if (!fields.organization) fail("organization: an external identity needs its organization");
    if (!fields.endDate) fail("endDate: external access is time-bound; give an end date");
    if (fields.endDate! <= today) fail("endDate: must be in the future");
  }
  if ((MACHINE_IDENTITY_TYPES as readonly string[]).includes(type) && !fields.ownerIdentityId) {
    fail("ownerIdentityId: a machine identity needs an accountable owner");
  }
  return fields;
}

/**
 * Validates tenant-defined attribute values against the active
 * definitions that apply to the identity's type (IDENTITY-P0-16).
 * Unknown keys are refused, so attributes cannot become an untyped dump;
 * required ones must be present; values are coerced to their type.
 */
export function validateAttributes(
  raw: unknown,
  definitions: Pick<IdentityAttributeDefinition, "name" | "displayName" | "identityType" | "dataType" | "required" | "allowedValues" | "validationRegex" | "active">[],
  identityType: IdentityType,
): Record<string, unknown> {
  const values = raw === undefined || raw === null ? {} : raw;
  if (typeof values !== "object" || Array.isArray(values)) fail("attributes: must be an object");
  const applicable = definitions.filter((d) => d.active && (d.identityType === null || d.identityType === identityType));
  const byName = new Map(applicable.map((d) => [d.name, d]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    const def = byName.get(key);
    if (!def) fail(`attributes.${key}: no such attribute for this identity type`);
    if (value === undefined || value === null || value === "") continue;
    switch (def!.dataType) {
      case "string": {
        if (typeof value !== "string" || value.length > 1000) fail(`attributes.${key}: text of at most 1000 characters`);
        if (def!.validationRegex) {
          let re: RegExp;
          try {
            re = new RegExp(def!.validationRegex);
          } catch {
            return fail(`attributes.${key}: the attribute's validation rule is invalid`);
          }
          if (!re.test(value as string)) fail(`attributes.${key}: does not match the required format`);
        }
        out[key] = value;
        break;
      }
      case "number": {
        const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
        if (!Number.isFinite(n)) fail(`attributes.${key}: must be a number`);
        out[key] = n;
        break;
      }
      case "boolean":
        if (value !== true && value !== false && value !== "true" && value !== "false") fail(`attributes.${key}: must be true or false`);
        out[key] = value === true || value === "true";
        break;
      case "date":
        if (typeof value !== "string" || !DATE_RE.test(value)) fail(`attributes.${key}: must be a date (YYYY-MM-DD)`);
        out[key] = value;
        break;
      case "enum":
        if (typeof value !== "string" || !def!.allowedValues.includes(value)) fail(`attributes.${key}: one of ${def!.allowedValues.join(", ")}`);
        out[key] = value;
        break;
    }
  }
  for (const def of applicable) {
    if (def.required && (out[def.name] === undefined || out[def.name] === "")) fail(`attributes.${def.name}: ${def.displayName} is required`);
  }
  return out;
}

/** Fields an update may carry, by identity kind. */
const AGENT_EDITABLE = new Set(["ownerIdentityId", "sponsorIdentityId", "attributes"]);
const ACCOUNT_OWNED = new Set(["displayName", "email", "username"]);

export type IdentityUpdateCurrent = Pick<
  ValidIdentityFields,
  Exclude<keyof ValidIdentityFields, "attributes">
> & { userId: string | null; sourceSystem: string | null };

/**
 * Validates a change to an existing identity (IDENTITY-P0-15) and returns
 * the merged fields. `patch` keys that are absent keep their current value.
 *
 * - An AI agent's identity follows its `agents` row, which stays canonical
 *   (spec R5): only its owner, sponsor and attributes are edited here.
 * - A member's name and email come from their sign-in account.
 * - The type never changes.
 * - The rules of `validateNewIdentity` hold for the merged result, except
 *   that an external identity past its end date can still be edited (to
 *   disable it, say) as long as the end date itself is not being set.
 */
export function validateIdentityUpdate(
  current: IdentityUpdateCurrent,
  patch: IdentityInput,
  today: string,
): { fields: ValidIdentityFields; changed: (keyof ValidIdentityFields)[] } {
  const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  if (keys.includes("identityType") && patch.identityType !== current.identityType) fail("identityType: an identity's type cannot change");
  if (current.identityType === "AI_AGENT") {
    const refused = keys.filter((k) => k !== "identityType" && !AGENT_EDITABLE.has(k));
    if (refused.length) fail(`${refused[0]}: edit the AI agent itself under AI Agents; its identity follows the agent`);
  }
  if (current.userId && current.sourceSystem === "wonderid") {
    const refused = keys.filter((k) => ACCOUNT_OWNED.has(k) && (patch as Record<string, unknown>)[k] !== (current as Record<string, unknown>)[k]);
    if (refused.length) fail(`${refused[0]}: a member's name and email come from their sign-in account`);
  }

  const merged: IdentityInput = { ...current, ...Object.fromEntries(keys.map((k) => [k, (patch as Record<string, unknown>)[k]])) };
  let fields: ValidIdentityFields;
  if (current.identityType === "AI_AGENT") {
    fields = {
      ...current,
      ownerIdentityId: uuid(merged.ownerIdentityId, "ownerIdentityId"),
      sponsorIdentityId: uuid(merged.sponsorIdentityId, "sponsorIdentityId"),
      attributes: {},
    };
  } else {
    // An expired external identity stays editable unless its end date is
    // the thing being changed.
    const endDateChanged = keys.includes("endDate") && patch.endDate !== current.endDate;
    const ruleDay = current.identityType === "EXTERNAL" && !endDateChanged ? "0000-01-01" : today;
    fields = validateNewIdentity({ ...merged, identityType: current.identityType }, ruleDay);
  }
  const changed = (Object.keys(fields) as (keyof ValidIdentityFields)[]).filter(
    (k) => k !== "attributes" && fields[k] !== (current as Record<string, unknown>)[k],
  );
  if (keys.includes("attributes")) changed.push("attributes");
  return { fields, changed };
}

export type AttributeDefinitionInput = {
  identityType?: unknown;
  name?: unknown;
  displayName?: unknown;
  dataType?: unknown;
  required?: unknown;
  sensitive?: unknown;
  searchable?: unknown;
  uniqueValue?: unknown;
  allowedValues?: unknown;
  validationRegex?: unknown;
  sourceMapping?: unknown;
};

const flag = (v: unknown) => v === true || v === "true" || v === "on";

/** Validates a tenant-defined attribute (IDENTITY-P0-16). */
export function validateAttributeDefinition(input: AttributeDefinitionInput) {
  const identityType = input.identityType === undefined || input.identityType === null || input.identityType === "" ? null : input.identityType;
  if (identityType !== null && (typeof identityType !== "string" || !(IDENTITY_TYPES as readonly string[]).includes(identityType))) {
    fail("identityType: an identity type, or empty for every type");
  }
  const name = text(input.name, "name", 63) ?? fail("name: required");
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) fail("name: lower-case letters, digits and underscores, starting with a letter");
  const displayName = text(input.displayName, "displayName", 120) ?? fail("displayName: required");
  const dataType = input.dataType;
  if (typeof dataType !== "string" || !(ATTRIBUTE_DATA_TYPES as readonly string[]).includes(dataType)) fail(`dataType: one of ${ATTRIBUTE_DATA_TYPES.join(", ")}`);
  const rawValues = Array.isArray(input.allowedValues)
    ? input.allowedValues
    : typeof input.allowedValues === "string"
      ? input.allowedValues.split(",")
      : [];
  const allowedValues = [...new Set(rawValues.map((v) => String(v).trim()).filter(Boolean))];
  if (allowedValues.some((v) => v.length > 200)) fail("allowedValues: each at most 200 characters");
  if (allowedValues.length > 100) fail("allowedValues: at most 100 values");
  if (dataType === "enum" && allowedValues.length === 0) fail("allowedValues: a choice list needs at least one value");
  const validationRegex = text(input.validationRegex, "validationRegex", 300);
  if (validationRegex) {
    if (dataType !== "string") fail("validationRegex: only text attributes take a format rule");
    try {
      new RegExp(validationRegex);
    } catch {
      fail("validationRegex: not a valid pattern");
    }
  }
  return {
    identityType: identityType as IdentityType | null,
    name,
    displayName,
    dataType: dataType as AttributeDataType,
    required: flag(input.required),
    sensitive: flag(input.sensitive),
    searchable: flag(input.searchable),
    uniqueValue: flag(input.uniqueValue),
    allowedValues: dataType === "enum" ? allowedValues : [],
    validationRegex,
    sourceMapping: text(input.sourceMapping, "sourceMapping", 200),
  };
}

/** Validates a new relationship between two identities (IDENTITY-P0-16). */
export function validateRelationshipInput(input: { sourceIdentityId?: unknown; targetIdentityId?: unknown; relationshipType?: unknown; validTo?: unknown }, now: Date) {
  const sourceIdentityId = uuid(input.sourceIdentityId, "sourceIdentityId") ?? fail("sourceIdentityId: required");
  const targetIdentityId = uuid(input.targetIdentityId, "targetIdentityId") ?? fail("targetIdentityId: required");
  if (sourceIdentityId === targetIdentityId) fail("targetIdentityId: an identity cannot relate to itself");
  const relationshipType = input.relationshipType;
  if (typeof relationshipType !== "string" || !(IDENTITY_RELATIONSHIP_TYPES as readonly string[]).includes(relationshipType)) {
    fail(`relationshipType: one of ${IDENTITY_RELATIONSHIP_TYPES.join(", ")}`);
  }
  const validTo = date(input.validTo, "validTo");
  if (validTo && Date.parse(`${validTo}T23:59:59Z`) <= now.getTime()) fail("validTo: must be in the future");
  return {
    sourceIdentityId,
    targetIdentityId,
    relationshipType: relationshipType as IdentityRelationshipType,
    validTo: validTo ? `${validTo}T23:59:59Z` : null,
  };
}
