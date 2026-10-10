import { describe, expect, it } from "vitest";
import { countDecisions, defaultIdentityType, identityMatcher, mapImportRecords, normalizeImportedIdentity, type IdentityCandidate } from "./fileImportPlan";
import { csvFile } from "./framework/definitions/csv-file";
import { csvRecords, parseCsv } from "./framework/csv";
import type { ResourceSpec } from "./framework/types";

const spec = (kind: "identity" | "account") => csvFile.resources[kind] as ResourceSpec;
const rows = (text: string) => csvRecords(parseCsv(text).table!);

describe("mapImportRecords", () => {
  it("maps rows with the definition and reports a row without a required value", () => {
    const { records, invalid } = mapImportRecords("identity", spec("identity").fields, {}, rows("Employee ID,Name,Work Email\nE1,Ada,ADA@X.TEST\n,No Id,b@x.test\n"));
    expect(records).toEqual([{ row: 2, externalId: "E1", values: expect.objectContaining({ externalId: "E1", displayName: "Ada", email: "ada@x.test" }) }]);
    expect(invalid).toEqual([expect.objectContaining({ row: 3, decision: "invalid", note: "no value for externalId" })]);
  });

  it("marks a repeated record invalid instead of importing it twice", () => {
    const { records, invalid } = mapImportRecords("identity", spec("identity").fields, {}, rows("id,name\nE1,Ada\nE1,Ada Again\n"));
    expect(records).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ row: 3, externalId: "E1", note: "the same record as row 2" });
  });
});

describe("normalizeImportedIdentity", () => {
  it("leaves empty cells out, so an import never blanks a field", () => {
    const n = normalizeImportedIdentity({ externalId: "E1", department: "Ops" });
    expect(n).toEqual({ externalId: "E1", identityType: null, fields: { department: "Ops" }, managerExternalId: null });
  });

  it("builds a name from first and last names, and reads the identity type", () => {
    expect(normalizeImportedIdentity({ externalId: "E1", firstName: "Ada", lastName: "Lovelace", identityType: "service account" })).toMatchObject({
      identityType: "SERVICE_ACCOUNT",
      fields: { displayName: "Ada Lovelace" },
    });
  });

  it("refuses a bad email, date, status or type", () => {
    expect(normalizeImportedIdentity({ externalId: "E1", email: "nope" })).toEqual({ invalid: expect.stringContaining("not an email") });
    expect(normalizeImportedIdentity({ externalId: "E1", startDate: "soon" })).toEqual({ invalid: expect.stringContaining("not a date") });
    expect(normalizeImportedIdentity({ externalId: "E1", status: "maybe" })).toEqual({ invalid: expect.stringContaining("not a known status") });
    expect(normalizeImportedIdentity({ externalId: "E1", identityType: "ai_agent" })).toEqual({ invalid: expect.stringContaining("identityType") });
  });
});

describe("identityMatcher", () => {
  const people: IdentityCandidate[] = [
    { id: "11111111-1111-4111-8111-111111111111", identityType: "HUMAN", email: "ada@x.test", username: "ada", sourceNativeId: "E1" },
    { id: "22222222-2222-4222-8222-222222222222", identityType: "HUMAN", email: "bo@x.test", username: "bo", sourceNativeId: null },
    { id: "33333333-3333-4333-8333-333333333333", identityType: "HUMAN", email: "twin@x.test", username: "t1", sourceNativeId: null },
    { id: "44444444-4444-4444-8444-444444444444", identityType: "HUMAN", email: "TWIN@x.test", username: "t2", sourceNativeId: null },
  ];

  it("matches by WonderID id, then source reference, then email, then username", () => {
    const m = identityMatcher(people);
    expect(m.match("22222222-2222-4222-8222-222222222222", {})).toMatchObject({ kind: "matched", identityId: people[1]!.id, by: "id" });
    expect(m.match("E1", {})).toMatchObject({ kind: "matched", identityId: people[0]!.id, by: "external id" });
    const m2 = identityMatcher(people);
    expect(m2.match("HR-9", { email: "BO@x.test" })).toMatchObject({ kind: "matched", identityId: people[1]!.id, by: "email" });
    expect(m2.match("HR-10", { username: "ADA" })).toMatchObject({ kind: "matched", by: "username" });
    expect(m2.match("HR-11", { email: "new@x.test" })).toEqual({ kind: "new" });
  });

  it("holds several matches, or a second row for the same identity, for a person to decide", () => {
    const m = identityMatcher(people);
    expect(m.match("HR-1", { email: "twin@x.test" })).toEqual({ kind: "review", reason: "2 identities have this email" });
    expect(m.match("E1", {})).toMatchObject({ kind: "matched" });
    expect(m.match("HR-2", { email: "ada@x.test" })).toEqual({ kind: "review", reason: "the same identity as E1" });
  });

  it("resolves a manager among existing identities only when unambiguous", () => {
    const m = identityMatcher(people);
    expect(m.resolveManager("E1")).toBe(people[0]!.id);
    expect(m.resolveManager("bo@x.test")).toBe(people[1]!.id);
    expect(m.resolveManager("twin@x.test")).toBeNull();
    expect(m.resolveManager("nobody")).toBeNull();
  });
});

describe("helpers", () => {
  it("counts decisions and picks the page's identity type", () => {
    expect(countDecisions([{ decision: "new" }, { decision: "new" }, { decision: "invalid" }])).toEqual({ new: 2, update: 0, unchanged: 0, invalid: 1, review: 0 });
    expect(defaultIdentityType("people")).toBe("HUMAN");
    expect(defaultIdentityType("external-identities")).toBe("EXTERNAL");
    expect(defaultIdentityType("machine-identities")).toBe("MACHINE");
    expect(defaultIdentityType(null)).toBe("HUMAN");
  });
});
