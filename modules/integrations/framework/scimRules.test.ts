import { describe, expect, it } from "vitest";
import {
  SCIM_ENTERPRISE_SCHEMA,
  SCIM_PATCH_SCHEMA,
  SCIM_USER_SCHEMA,
  applyScimPatch,
  cleanUser,
  mappingScope,
  parseScimFilter,
  scimPage,
  scimTarget,
} from "./scimRules";
import { mapRecord } from "./mapping";
import { scimInbound } from "./definitions/scim-inbound";

const ID = "3f2c1a9e-8d7b-4c6a-9e5f-1a2b3c4d5e6f";
const user = (over: Record<string, unknown> = {}) => ({ schemas: [SCIM_USER_SCHEMA], userName: "ana@example.com", active: true, ...over });
const patch = (...Operations: unknown[]) => ({ schemas: [SCIM_PATCH_SCHEMA], Operations });

describe("scimTarget (INTEGRATION-P0-22)", () => {
  it("serves Users, one user by id, and the service's configuration", () => {
    expect(scimTarget("scim/v2/Users")).toEqual({ kind: "users", id: null });
    expect(scimTarget(`scim/v2/Users/${ID.toUpperCase()}`)).toEqual({ kind: "users", id: ID });
    expect(scimTarget("scim/v2/ServiceProviderConfig")).toEqual({ kind: "config" });
  });
  it("serves nothing else", () => {
    expect(scimTarget("scim/v2/Groups")).toBeNull();
    expect(scimTarget("scim/v2/Users/not-an-id")).toBeNull();
    expect(scimTarget(`scim/v2/Users/${ID}/extra`)).toBeNull();
  });
});

describe("parseScimFilter", () => {
  it("reads the userName and externalId equality filters identity providers send", () => {
    expect(parseScimFilter('userName eq "ana@example.com"')).toEqual({ attribute: "userName", value: "ana@example.com" });
    expect(parseScimFilter('externalId eq "00u1"')).toEqual({ attribute: "externalId", value: "00u1" });
    expect(parseScimFilter('username EQ "a\\"b"')).toEqual({ attribute: "userName", value: 'a"b' });
    expect(parseScimFilter(null)).toBeNull();
  });
  it("refuses any other filter instead of guessing", () => {
    expect(parseScimFilter('userName sw "a"')).toBe("invalid");
    expect(parseScimFilter('userName eq "a" or userName eq "b"')).toBe("invalid");
    expect(parseScimFilter("emails.value eq x")).toBe("invalid");
  });
});

describe("scimPage", () => {
  it("is 1-based and capped", () => {
    expect(scimPage(null, null)).toEqual({ offset: 0, limit: 200 });
    expect(scimPage("11", "5")).toEqual({ offset: 10, limit: 5 });
    expect(scimPage("0", "5000")).toEqual({ offset: 0, limit: 200 });
    expect(scimPage("1", "0")).toEqual({ offset: 0, limit: 0 });
  });
});

describe("cleanUser", () => {
  it("needs the User schema and a userName, and drops what only WonderID sets", () => {
    expect(cleanUser(user({ id: "chosen", meta: { created: "x" }, password: "p" }))).toEqual(user());
    expect(cleanUser({ userName: "a" })).toMatch(/schemas/);
    expect(cleanUser(user({ userName: " " }))).toMatch(/userName/);
    expect(cleanUser([])).toMatch(/User object/);
  });
});

describe("applyScimPatch", () => {
  it("deactivates a user the way Okta and Entra do", () => {
    expect(applyScimPatch(user(), patch({ op: "replace", path: "active", value: false }))).toEqual({ ok: true, user: user({ active: false }) });
    expect(applyScimPatch(user(), patch({ op: "Replace", value: { active: "False" } }))).toEqual({ ok: true, user: user({ active: false }) });
  });
  it("sets nested and extension attributes without touching the stored user", () => {
    const before: Record<string, unknown> = user({ name: { givenName: "Ana", familyName: "Lee" } });
    const r = applyScimPatch(before, patch({ op: "replace", path: "name.givenName", value: "Anna" }, { op: "add", path: `${SCIM_ENTERPRISE_SCHEMA}:department`, value: "Finance" }));
    expect(r).toEqual({ ok: true, user: { ...before, name: { givenName: "Anna", familyName: "Lee" }, [SCIM_ENTERPRISE_SCHEMA]: { department: "Finance" } } });
    expect(before.name).toEqual({ givenName: "Ana", familyName: "Lee" });
  });
  it("removes an attribute", () => {
    expect(applyScimPatch(user({ title: "Analyst" }), patch({ op: "remove", path: "title" }))).toEqual({ ok: true, user: user() });
  });
  it("refuses filters in paths, changes to id, meta or schemas, and a user left without a userName", () => {
    expect(applyScimPatch(user(), patch({ op: "replace", path: 'emails[type eq "work"].value', value: "x" }))).toMatchObject({ ok: false, scimType: "invalidPath" });
    expect(applyScimPatch(user(), patch({ op: "replace", path: "id", value: "x" }))).toMatchObject({ ok: false, scimType: "mutability" });
    expect(applyScimPatch(user(), patch({ op: "replace", value: { meta: {} } }))).toMatchObject({ ok: false, scimType: "mutability" });
    expect(applyScimPatch(user(), patch({ op: "remove", path: "userName" }))).toMatchObject({ ok: false, status: 400 });
    expect(applyScimPatch(user(), { Operations: [] })).toMatchObject({ ok: false, scimType: "invalidSyntax" });
    expect(applyScimPatch(user(), patch({ op: "move", path: "title" }))).toMatchObject({ ok: false, scimType: "invalidSyntax" });
  });
});

describe("the scim-inbound mapping", () => {
  it("maps a pushed user to identity fields, the id always the one WonderID assigned", () => {
    const pushed = user({
      externalId: "00u1",
      name: { givenName: "Ana", familyName: "Lee" },
      emails: [{ value: "Ana.Lee@Example.com", primary: true }],
      title: "Analyst",
      active: false,
      [SCIM_ENTERPRISE_SCHEMA]: { department: "Finance", manager: { value: "mgr-1" } },
    });
    const fields = { ...scimInbound.receive!.scim!.fields, externalId: { value: ID } } as Parameters<typeof mapRecord>[1];
    const mapped = mapRecord("identity", fields, mappingScope(pushed));
    expect(mapped).toMatchObject({
      externalId: ID,
      normalized: { externalId: ID, firstName: "Ana", lastName: "Lee", email: "ana.lee@example.com", username: "ana@example.com", title: "Analyst", department: "Finance", managerExternalId: "mgr-1", status: "disabled" },
    });
  });
});
