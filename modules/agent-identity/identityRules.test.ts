import { describe, expect, it } from "vitest";
import {
  validateAttributeDefinition,
  validateAttributes,
  validateIdentityUpdate,
  validateNewIdentity,
  validateRelationshipInput,
  type IdentityUpdateCurrent,
} from "./identityRules";
import type { IdentityAttributeDefinition } from "@/lib/shared/types/agent-identity";

const TODAY = "2026-09-26";
const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe("validateNewIdentity", () => {
  it("accepts a person with only a name, defaulting to active", () => {
    const f = validateNewIdentity({ identityType: "HUMAN", displayName: "  Ada Lovelace " }, TODAY);
    expect(f).toMatchObject({ identityType: "HUMAN", displayName: "Ada Lovelace", status: "active", privileged: false, email: null });
  });

  it("refuses AI agents, unknown types and a missing name", () => {
    expect(err(() => validateNewIdentity({ identityType: "AI_AGENT", displayName: "x" }, TODAY))).toMatch(/register AI agents/);
    expect(err(() => validateNewIdentity({ identityType: "ROBOT", displayName: "x" }, TODAY))).toMatch(/identityType/);
    expect(err(() => validateNewIdentity({ identityType: "HUMAN", displayName: "   " }, TODAY))).toMatch(/displayName: required/);
  });

  it("requires an external identity's sponsor, organization and a future end date", () => {
    const base = { identityType: "EXTERNAL", displayName: "Contractor", sponsorIdentityId: PERSON, organization: "Acme", endDate: "2027-01-01" };
    expect(validateNewIdentity(base, TODAY).endDate).toBe("2027-01-01");
    expect(err(() => validateNewIdentity({ ...base, sponsorIdentityId: "" }, TODAY))).toMatch(/sponsor/);
    expect(err(() => validateNewIdentity({ ...base, organization: undefined }, TODAY))).toMatch(/organization/);
    expect(err(() => validateNewIdentity({ ...base, endDate: undefined }, TODAY))).toMatch(/time-bound/);
    expect(err(() => validateNewIdentity({ ...base, endDate: TODAY }, TODAY))).toMatch(/future/);
  });

  it("requires a machine identity's owner", () => {
    for (const identityType of ["SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API", "MACHINE"]) {
      expect(err(() => validateNewIdentity({ identityType, displayName: "svc" }, TODAY))).toMatch(/accountable owner/);
      expect(validateNewIdentity({ identityType, displayName: "svc", ownerIdentityId: PERSON }, TODAY).ownerIdentityId).toBe(PERSON);
    }
  });

  it("validates email, ids, dates and their order", () => {
    expect(err(() => validateNewIdentity({ identityType: "HUMAN", displayName: "x", email: "nope" }, TODAY))).toMatch(/email/);
    expect(err(() => validateNewIdentity({ identityType: "HUMAN", displayName: "x", managerIdentityId: "not-a-uuid" }, TODAY))).toMatch(/managerIdentityId/);
    expect(err(() => validateNewIdentity({ identityType: "HUMAN", displayName: "x", startDate: "2026-13-45" }, TODAY))).toMatch(/startDate/);
    expect(err(() => validateNewIdentity({ identityType: "HUMAN", displayName: "x", startDate: "2026-10-01", endDate: "2026-09-01" }, TODAY))).toMatch(/on or after/);
    expect(err(() => validateNewIdentity({ identityType: "HUMAN", displayName: "x", status: "gone" }, TODAY))).toMatch(/status/);
  });

  it("never takes a tenant from the input", () => {
    const f = validateNewIdentity({ identityType: "HUMAN", displayName: "x", ...({ tenantId: OTHER } as object) }, TODAY);
    expect(f).not.toHaveProperty("tenantId");
  });
});

const def = (over: Partial<IdentityAttributeDefinition>): IdentityAttributeDefinition => ({
  id: "d",
  tenantId: "t",
  identityType: null,
  name: "cost_center",
  displayName: "Cost center",
  dataType: "string",
  required: false,
  sensitive: false,
  searchable: false,
  uniqueValue: false,
  allowedValues: [],
  validationRegex: null,
  sourceMapping: null,
  active: true,
  createdAt: "",
  ...over,
});

describe("validateAttributes", () => {
  it("coerces values to their type", () => {
    const defs = [def({ name: "n", dataType: "number" }), def({ name: "b", dataType: "boolean" }), def({ name: "d", dataType: "date" }), def({ name: "e", dataType: "enum", allowedValues: ["EMEA"] })];
    expect(validateAttributes({ n: "4.5", b: "true", d: "2026-01-02", e: "EMEA" }, defs, "HUMAN")).toEqual({ n: 4.5, b: true, d: "2026-01-02", e: "EMEA" });
  });

  it("refuses unknown keys, wrong types, values outside a choice list, and format mismatches", () => {
    expect(err(() => validateAttributes({ x: "1" }, [def({})], "HUMAN"))).toMatch(/no such attribute/);
    expect(err(() => validateAttributes({ n: "abc" }, [def({ name: "n", dataType: "number" })], "HUMAN"))).toMatch(/number/);
    expect(err(() => validateAttributes({ e: "MARS" }, [def({ name: "e", dataType: "enum", allowedValues: ["EMEA"] })], "HUMAN"))).toMatch(/one of EMEA/);
    expect(err(() => validateAttributes({ cost_center: "12" }, [def({ validationRegex: "^CC-\\d{4}$" })], "HUMAN"))).toMatch(/format/);
    expect(validateAttributes({ cost_center: "CC-1234" }, [def({ validationRegex: "^CC-\\d{4}$" })], "HUMAN")).toEqual({ cost_center: "CC-1234" });
  });

  it("only applies active definitions for the identity's type", () => {
    const scoped = def({ name: "region", identityType: "SERVICE_ACCOUNT" });
    expect(err(() => validateAttributes({ region: "x" }, [scoped], "HUMAN"))).toMatch(/no such attribute/);
    expect(err(() => validateAttributes({ cost_center: "x" }, [def({ active: false })], "HUMAN"))).toMatch(/no such attribute/);
  });

  it("enforces required attributes and drops blanks", () => {
    expect(err(() => validateAttributes({}, [def({ required: true })], "HUMAN"))).toMatch(/Cost center is required/);
    expect(err(() => validateAttributes({ cost_center: "" }, [def({ required: true })], "HUMAN"))).toMatch(/required/);
    expect(validateAttributes({ cost_center: "" }, [def({})], "HUMAN")).toEqual({});
    expect(err(() => validateAttributes(["a"], [def({})], "HUMAN"))).toMatch(/object/);
  });
});

const current = (over: Partial<IdentityUpdateCurrent>): IdentityUpdateCurrent => ({
  identityType: "HUMAN",
  subtype: null,
  displayName: "Ada",
  username: null,
  email: "ada@example.test",
  status: "active",
  ownerIdentityId: null,
  sponsorIdentityId: null,
  managerIdentityId: null,
  department: null,
  title: null,
  businessUnit: null,
  location: null,
  employmentType: null,
  organization: null,
  purpose: null,
  startDate: null,
  endDate: null,
  privileged: false,
  userId: null,
  sourceSystem: "manual",
  ...over,
});

describe("validateIdentityUpdate", () => {
  it("merges the patch and reports the changed fields", () => {
    const { fields, changed } = validateIdentityUpdate(current({}), { title: "CFO", department: "" }, TODAY);
    expect(fields.title).toBe("CFO");
    expect(fields.displayName).toBe("Ada");
    expect(changed).toEqual(["title"]);
  });

  it("never changes the type", () => {
    expect(err(() => validateIdentityUpdate(current({}), { identityType: "EXTERNAL" }, TODAY))).toMatch(/cannot change/);
  });

  it("keeps an AI agent's identity following the agent", () => {
    const agent = current({ identityType: "AI_AGENT", displayName: "FinanceBot" });
    expect(err(() => validateIdentityUpdate(agent, { displayName: "Renamed" }, TODAY))).toMatch(/under AI Agents/);
    expect(err(() => validateIdentityUpdate(agent, { status: "disabled" }, TODAY))).toMatch(/under AI Agents/);
    const { fields, changed } = validateIdentityUpdate(agent, { ownerIdentityId: PERSON }, TODAY);
    expect(fields.ownerIdentityId).toBe(PERSON);
    expect(changed).toEqual(["ownerIdentityId"]);
  });

  it("keeps a member's name and email with their sign-in account", () => {
    const member = current({ userId: OTHER, sourceSystem: "wonderid" });
    expect(err(() => validateIdentityUpdate(member, { email: "new@example.test" }, TODAY))).toMatch(/sign-in account/);
    expect(validateIdentityUpdate(member, { email: "ada@example.test", title: "CFO" }, TODAY).changed).toEqual(["title"]);
  });

  it("lets an expired external identity be disabled, but not re-dated into the past", () => {
    const ext = current({ identityType: "EXTERNAL", sponsorIdentityId: PERSON, organization: "Acme", endDate: "2026-01-01" });
    expect(validateIdentityUpdate(ext, { status: "disabled" }, TODAY).fields.status).toBe("disabled");
    expect(err(() => validateIdentityUpdate(ext, { endDate: "2026-02-01" }, TODAY))).toMatch(/future/);
    expect(validateIdentityUpdate(ext, { endDate: "2027-02-01" }, TODAY).changed).toEqual(["endDate"]);
    expect(err(() => validateIdentityUpdate(ext, { sponsorIdentityId: "" }, TODAY))).toMatch(/sponsor/);
  });

  it("does not let a machine identity lose its owner", () => {
    const svc = current({ identityType: "SERVICE_ACCOUNT", ownerIdentityId: PERSON });
    expect(err(() => validateIdentityUpdate(svc, { ownerIdentityId: "" }, TODAY))).toMatch(/accountable owner/);
  });
});

describe("validateAttributeDefinition", () => {
  it("accepts a choice list and normalizes its values", () => {
    const d = validateAttributeDefinition({ name: "region", displayName: "Region", dataType: "enum", allowedValues: " EMEA, AMER ,EMEA,", required: "on" });
    expect(d).toMatchObject({ allowedValues: ["EMEA", "AMER"], required: true, identityType: null });
  });

  it("refuses bad keys, empty choice lists, invalid patterns and patterns on non-text", () => {
    expect(err(() => validateAttributeDefinition({ name: "Cost Center", displayName: "x", dataType: "string" }))).toMatch(/lower-case/);
    expect(err(() => validateAttributeDefinition({ name: "r", displayName: "x", dataType: "enum", allowedValues: "" }))).toMatch(/at least one/);
    expect(err(() => validateAttributeDefinition({ name: "r", displayName: "x", dataType: "string", validationRegex: "([" }))).toMatch(/not a valid pattern/);
    expect(err(() => validateAttributeDefinition({ name: "r", displayName: "x", dataType: "number", validationRegex: "^1$" }))).toMatch(/only text/);
    expect(err(() => validateAttributeDefinition({ name: "r", displayName: "x", dataType: "string", identityType: "ROBOT" }))).toMatch(/identityType/);
  });
});

describe("validateRelationshipInput", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  it("accepts a typed edge with an optional future end", () => {
    expect(validateRelationshipInput({ sourceIdentityId: PERSON, targetIdentityId: OTHER, relationshipType: "owns", validTo: "2027-01-01" }, now)).toEqual({
      sourceIdentityId: PERSON,
      targetIdentityId: OTHER,
      relationshipType: "owns",
      validTo: "2027-01-01T23:59:59Z",
    });
  });

  it("refuses self-edges, unknown types and past ends", () => {
    expect(err(() => validateRelationshipInput({ sourceIdentityId: PERSON, targetIdentityId: PERSON, relationshipType: "owns" }, now))).toMatch(/itself/);
    expect(err(() => validateRelationshipInput({ sourceIdentityId: PERSON, targetIdentityId: OTHER, relationshipType: "likes" }, now))).toMatch(/relationshipType/);
    expect(err(() => validateRelationshipInput({ sourceIdentityId: PERSON, targetIdentityId: OTHER, relationshipType: "owns", validTo: "2026-01-01" }, now))).toMatch(/future/);
  });
});
