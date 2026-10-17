import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chosenColumns, duplicateReason, MERGE_FIELDS, mergeDifferences, mergeRefusal } from "./identityMerge";

type P = Parameters<typeof mergeDifferences>[0];

const person = (over: Partial<P> = {}): P => ({
  id: "a",
  identityType: "HUMAN",
  status: "active",
  userId: null,
  mergedIntoIdentityId: null,
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  username: null,
  title: null,
  department: "Finance",
  businessUnit: null,
  location: null,
  employmentType: null,
  organization: null,
  managerIdentityId: null,
  startDate: null,
  endDate: null,
  ...over,
});

describe("IDENTITY-P0-23: merging two records of the same person", () => {
  it("lists only the attributes on which the records differ", () => {
    const diff = mergeDifferences(person(), person({ id: "b", department: "Risk", title: "Analyst" }));
    expect(diff.map((f) => f.column)).toEqual(["title", "department"]);
  });

  it("keeps the survivor's value unless the other is chosen; a blank takes the other value", () => {
    const s = person();
    const m = person({ id: "b", department: "Risk", title: "Analyst" });
    expect(chosenColumns(s, m, [])).toEqual(["title"]);
    expect(chosenColumns(s, m, ["department"])).toEqual(["title", "department"]);
  });

  it("never takes a blank from the other record, and refuses an unknown attribute", () => {
    expect(chosenColumns(person({ title: "Lead" }), person({ id: "b" }), ["title"])).toEqual([]);
    expect(() => chosenColumns(person(), person({ id: "b" }), ["privileged"])).toThrow(/cannot be merged/);
  });

  it("refuses the same record, different kinds, machines, merged records and two sign-ins", () => {
    expect(mergeRefusal(person(), person())).toMatch(/two different/);
    expect(mergeRefusal(person(), person({ id: "b", identityType: "EXTERNAL" }))).toMatch(/same kind/);
    expect(mergeRefusal(person({ identityType: "MACHINE" }), person({ id: "b", identityType: "MACHINE" }))).toMatch(/same kind/);
    expect(mergeRefusal(person(), person({ id: "b", mergedIntoIdentityId: "c" }))).toMatch(/already been merged/);
    expect(mergeRefusal(person({ userId: "u1" }), person({ id: "b", userId: "u2" }))).toMatch(/Both records sign in/);
    expect(mergeRefusal(person({ userId: "u1" }), person({ id: "b" }))).toBeNull();
  });

  it("finds duplicates by email, then by name, ignoring case and spacing", () => {
    expect(duplicateReason({ id: "a", displayName: "Ada", email: "ADA@example.test " }, { id: "b", displayName: "A. L.", email: "ada@example.test" })).toBe("email");
    expect(duplicateReason({ id: "a", displayName: "Ada  Lovelace", email: null }, { id: "b", displayName: "ada lovelace", email: "x@y" })).toBe("name");
    expect(duplicateReason({ id: "a", displayName: "Ada", email: null }, { id: "b", displayName: "Grace", email: null })).toBeNull();
    expect(duplicateReason({ id: "a", displayName: "Ada", email: null }, { id: "a", displayName: "Ada", email: null })).toBeNull();
  });

  it("offers the same attributes the database function accepts", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "0198_identity_merge.sql"), "utf8");
    const listed = /select array\[([^\]]+)\]/.exec(sql)![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1));
    expect(MERGE_FIELDS.map((f) => f.column).sort()).toEqual(listed.sort());
  });
});
