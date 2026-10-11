import { describe, expect, it } from "vitest";
import { correlate, normalizeRecord, parseCsv, planLeavers, validateMappings, validateSourceConfig, type NormalizedSourceRecord } from "./identitySourceRules";
import { coerceSourcedAttributes, mergeSourcedAttributes, mergeSourcedFields } from "@/modules/agent-identity/sourcedMerge";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

const MAPPINGS = [
  { source: "Employee ID", target: "externalId" as const },
  { source: "Name", target: "displayName" as const },
  { source: "Email", target: "email" as const },
  { source: "Dept", target: "department" as const },
  { source: "Status", target: "status" as const },
  { source: "Start", target: "startDate" as const },
  { source: "Manager ID", target: "managerExternalId" as const },
];

describe("validateSourceConfig", () => {
  const base = { name: "Workday", template: "csv", attributeMappings: MAPPINGS };

  it("accepts a CSV source with defaults", () => {
    const c = validateSourceConfig(base);
    expect(c).toMatchObject({ identityType: "HUMAN", priority: 100, authoritative: false, leaverStrategy: "disable", leaverThresholdPercent: 20, correlationRules: [{ kind: "email" }] });
  });

  it("needs an external id and a display name mapping, each mapped once", () => {
    expect(err(() => validateSourceConfig({ ...base, attributeMappings: MAPPINGS.filter((m) => m.target !== "externalId") }))).toMatch(/externalId/);
    expect(err(() => validateSourceConfig({ ...base, attributeMappings: MAPPINGS.filter((m) => m.target !== "displayName") }))).toMatch(/displayName/);
    expect(err(() => validateSourceConfig({ ...base, attributeMappings: [...MAPPINGS, { source: "Mail2", target: "email" }] }))).toMatch(/mapped twice/);
    expect(err(() => validateSourceConfig({ ...base, attributeMappings: [...MAPPINGS, { source: "X", target: "tenantId" }] }))).toMatch(/unknown field/);
  });

  it("only lets an authoritative source own fields, and only identity fields", () => {
    expect(err(() => validateSourceConfig({ ...base, authoritativeFields: ["department"] }))).toMatch(/only an authoritative source/);
    expect(validateSourceConfig({ ...base, authoritative: "on", authoritativeFields: "department,title" }).authoritativeFields).toEqual(["department", "title"]);
    expect(err(() => validateSourceConfig({ ...base, authoritative: true, authoritativeFields: ["salary"] }))).toMatch(/not an identity field/);
  });

  it("validates templates, integrations, precedence and correlation rules", () => {
    expect(err(() => validateSourceConfig({ ...base, template: "ldap" }))).toMatch(/template/);
    expect(err(() => validateSourceConfig({ ...base, template: "integration" }))).toMatch(/integrationId/);
    expect(err(() => validateSourceConfig({ ...base, priority: 0 }))).toMatch(/priority/);
    expect(err(() => validateSourceConfig({ ...base, identityType: "AI_AGENT" }))).toMatch(/identityType/);
    expect(err(() => validateSourceConfig({ ...base, correlationRules: [{ kind: "composite", fields: ["displayName"] }] }))).toMatch(/2 to 4 fields/);
    expect(err(() => validateSourceConfig({ ...base, correlationRules: [{ kind: "email" }, { kind: "email" }] }))).toMatch(/twice/);
    expect(validateSourceConfig({ ...base, correlationRules: JSON.stringify([{ kind: "username" }, { kind: "composite", fields: ["displayName", "startDate"] }]) }).correlationRules).toHaveLength(2);
  });
});

describe("parseCsv", () => {
  it("handles quotes, embedded commas and newlines, CRLF, a BOM and blank lines", () => {
    const { headers, rows } = parseCsv('﻿Employee ID,Name,Note\r\n1,"Lovelace, Ada","said ""hi""\nthen left"\r\n\r\n2,Grace Hopper,\n');
    expect(headers).toEqual(["Employee ID", "Name", "Note"]);
    expect(rows).toEqual([
      { "Employee ID": "1", Name: "Lovelace, Ada", Note: 'said "hi"\nthen left' },
      { "Employee ID": "2", Name: "Grace Hopper", Note: "" },
    ]);
  });

  it("refuses empty files, blank or duplicate headers and unclosed quotes", () => {
    expect(err(() => parseCsv(""))).toMatch(/empty/);
    expect(err(() => parseCsv("a,,c\n1,2,3"))).toMatch(/header/);
    expect(err(() => parseCsv("a,a\n1,2"))).toMatch(/same header/);
    expect(err(() => parseCsv('a,b\n"1,2'))).toMatch(/not closed/);
  });
});

describe("normalizeRecord", () => {
  it("maps, lower-cases email, reads status words and dates, keeps the manager reference", () => {
    const n = normalizeRecord({ "Employee ID": "E1", Name: "Ada", Email: "Ada@Example.test", Dept: "Finance", Status: "Terminated", Start: "2026-01-05T00:00:00Z", "Manager ID": "E0" }, MAPPINGS);
    expect(n).toEqual({ externalId: "E1", managerExternalId: "E0", fields: { displayName: "Ada", email: "ada@example.test", department: "Finance", status: "terminated", startDate: "2026-01-05" }, attributes: {} });
  });

  it("carries custom attribute values as the source sent them, a blank as null", () => {
    const n = normalizeRecord({ id: "E1", name: "Ada", cc: " 4100 ", badge: "" }, [
      { source: "id", target: "externalId" },
      { source: "name", target: "displayName" },
      { source: "cc", target: "attribute:cost_center" },
      { source: "badge", target: "attribute:badge_number" },
    ]);
    expect(n).toMatchObject({ externalId: "E1", attributes: { cost_center: "4100", badge_number: null } });
    expect((n as { fields: Record<string, unknown> }).fields).not.toHaveProperty("attribute:cost_center");
  });

  it("reports why a record cannot be used, instead of applying part of it", () => {
    const row = { "Employee ID": "E1", Name: "Ada", Email: "ada@example.test", Dept: "", Status: "A", Start: "", "Manager ID": "" };
    expect(normalizeRecord({ ...row, "Employee ID": "" }, MAPPINGS)).toEqual({ invalid: "no external id" });
    expect(normalizeRecord({ ...row, Name: "" }, MAPPINGS)).toEqual({ invalid: "no display name" });
    expect(normalizeRecord({ ...row, Email: "nope" }, MAPPINGS)).toMatchObject({ invalid: expect.stringMatching(/not an email/) });
    expect(normalizeRecord({ ...row, Status: "retired-ish" }, MAPPINGS)).toMatchObject({ invalid: expect.stringMatching(/not a known status/) });
    expect(normalizeRecord({ ...row, Start: "05/01/2026" }, MAPPINGS)).toMatchObject({ invalid: expect.stringMatching(/not a date/) });
  });

  it("reads dotted paths from integration records", () => {
    const n = normalizeRecord({ externalId: "x1", normalized: { displayName: "Svc", email: "svc@example.test" } }, [
      { source: "externalId", target: "externalId" },
      { source: "normalized.displayName", target: "displayName" },
      { source: "normalized.email", target: "email" },
    ]);
    expect(n).toMatchObject({ externalId: "x1", fields: { displayName: "Svc", email: "svc@example.test" } });
  });
});

describe("validateMappings: custom attributes (INTEGRATION-P0-20)", () => {
  const base = [
    { source: "id", target: "externalId" },
    { source: "name", target: "displayName" },
  ];
  const defs = [
    { name: "cost_center", identityType: null, active: true },
    { name: "clearance", identityType: "HUMAN", active: true },
    { name: "old_code", identityType: null, active: false },
  ];
  it("accepts an active attribute that applies to the source's identity type", () => {
    const out = validateMappings([...base, { source: "cc", target: "attribute:cost_center" }, { source: "lvl", target: "attribute:clearance" }], defs, "HUMAN");
    expect(out.map((m) => m.target)).toContain("attribute:clearance");
  });
  it("refuses an attribute that does not exist or is retired", () => {
    expect(() => validateMappings([...base, { source: "x", target: "attribute:nope" }], defs, "HUMAN")).toThrow(/does not exist/);
    expect(() => validateMappings([...base, { source: "x", target: "attribute:old_code" }], defs, "HUMAN")).toThrow(/does not exist/);
  });
  it("refuses an attribute for another identity type", () => {
    expect(() => validateMappings([...base, { source: "lvl", target: "attribute:clearance" }], defs, "SERVICE_ACCOUNT")).toThrow(/for HUMAN identities, not SERVICE_ACCOUNT/);
  });
  it("refuses the same attribute twice", () => {
    expect(() => validateMappings([...base, { source: "a", target: "attribute:cost_center" }, { source: "b", target: "attribute:cost_center" }], defs, "HUMAN")).toThrow(/mapped twice/);
  });
});

describe("correlate", () => {
  const rec = (fields: NormalizedSourceRecord["fields"]): NormalizedSourceRecord => ({ externalId: "E9", fields: { displayName: "Ada", ...fields }, managerExternalId: null, attributes: {} });
  const index = [
    { id: "i1", email: "ada@example.test", username: "ada", displayName: "Ada", startDate: "2026-01-05" },
    { id: "i2", email: "twin@example.test", username: "twin", displayName: "Twin", startDate: null },
    { id: "i3", email: "twin@example.test", username: "twin2", displayName: "Twin", startDate: null },
  ];

  it("keeps an existing link above every rule", () => {
    expect(correlate(rec({ email: "twin@example.test" }), [{ kind: "email" }], index, "i1", new Set())).toEqual({ kind: "linked", identityId: "i1" });
  });

  it("matches one candidate, flags several as ambiguous, and falls through when none", () => {
    expect(correlate(rec({ email: "ADA@example.test" }), [{ kind: "email" }], index, null, new Set())).toMatchObject({ kind: "matched", identityId: "i1" });
    expect(correlate(rec({ email: "twin@example.test" }), [{ kind: "email" }, { kind: "username" }], index, null, new Set())).toMatchObject({
      kind: "ambiguous",
      candidateIds: ["i2", "i3"],
    });
    expect(correlate(rec({ email: "new@example.test", username: "twin2" }), [{ kind: "email" }, { kind: "username" }], index, null, new Set())).toMatchObject({
      kind: "matched",
      identityId: "i3",
      rule: "username",
    });
    expect(correlate(rec({ email: "new@example.test" }), [{ kind: "email" }], index, null, new Set())).toEqual({ kind: "new" });
  });

  it("matches composites and never picks an identity another record already holds", () => {
    expect(correlate(rec({ startDate: "2026-01-05" }), [{ kind: "composite", fields: ["displayName", "startDate"] }], index, null, new Set())).toMatchObject({ identityId: "i1" });
    expect(correlate(rec({ email: "ada@example.test" }), [{ kind: "email" }], index, null, new Set(["i1"]))).toEqual({ kind: "new" });
  });
});

describe("planLeavers", () => {
  const links = Array.from({ length: 10 }, (_, i) => ({ externalId: `E${i}`, identityId: `i${i}` }));

  it("returns the absent records as leavers within the threshold", () => {
    const seen = new Set(links.slice(1).map((l) => l.externalId));
    expect(planLeavers(links, seen, 20)).toEqual({ leavers: [links[0]], guardTripped: false });
  });

  it("applies no leavers when too many are missing (a truncated file)", () => {
    const seen = new Set(links.slice(0, 4).map((l) => l.externalId));
    expect(planLeavers(links, seen, 20)).toEqual({ leavers: [], guardTripped: true });
    // Fewer than five absent never trips the guard.
    expect(planLeavers(links.slice(0, 4), new Set(), 20).guardTripped).toBe(false);
  });
});

describe("mergeSourcedFields (Identity precedence)", () => {
  const at = "2026-09-26T00:00:00Z";
  const hr = { sourceId: "hr", priority: 10, authoritativeFields: ["department" as const, "title" as const] };
  const dir = { sourceId: "dir", priority: 50, authoritativeFields: ["department" as const] };

  it("lets an authoritative source set its fields and records provenance", () => {
    const r = mergeSourcedFields({ department: "Ops" }, {}, { department: "Finance" }, hr, at);
    expect(r.changes).toEqual({ department: "Finance" });
    expect(r.provenance.department).toEqual({ sourceId: "hr", priority: 10, at });
  });

  it("never lets a lower-precedence source overwrite a higher one", () => {
    const r = mergeSourcedFields({ department: "Finance" }, { department: { sourceId: "hr", priority: 10, at } }, { department: "Sales" }, dir, at);
    expect(r.changes).toEqual({});
    expect(r.skipped).toEqual([{ field: "department", reason: "higher_precedence" }]);
  });

  it("lets a non-authoritative field only fill a blank", () => {
    expect(mergeSourcedFields({ location: null }, {}, { location: "Oslo" }, hr, at).changes).toEqual({ location: "Oslo" });
    const kept = mergeSourcedFields({ location: "Bergen" }, {}, { location: "Oslo" }, hr, at);
    expect(kept.changes).toEqual({});
    expect(kept.skipped).toEqual([{ field: "location", reason: "not_authoritative" }]);
  });

  it("treats an unchanged value as no change, and lets a source correct its own value", () => {
    expect(mergeSourcedFields({ title: "CFO" }, {}, { title: "CFO" }, hr, at).changes).toEqual({});
    const own = mergeSourcedFields({ title: "CFO" }, { title: { sourceId: "hr", priority: 10, at } }, { title: "CEO" }, hr, at);
    expect(own.changes).toEqual({ title: "CEO" });
  });
});

describe("custom attributes from a source (Identity, INTEGRATION-P0-20)", () => {
  const at = "2026-10-11T00:00:00Z";
  const hr = { sourceId: "hr", priority: 10, authoritativeFields: [], ownsAttributes: true };
  const dir = { sourceId: "dir", priority: 50, authoritativeFields: [], ownsAttributes: true };
  const sheet = { sourceId: "sheet", priority: 90, authoritativeFields: [], ownsAttributes: false };
  const def = (name: string, dataType: "string" | "number" | "boolean" | "date" | "enum", extra: Record<string, unknown> = {}) => ({
    name,
    displayName: name,
    identityType: null,
    dataType,
    required: true,
    allowedValues: [] as string[],
    validationRegex: null,
    active: true,
    ...extra,
  });
  const defs = [def("cost_center", "string"), def("grade", "number"), def("contractor", "boolean"), def("level", "enum", { allowedValues: ["L1", "L2"] }), def("old", "string", { active: false })];

  it("types each value, keeps a blank as null, leaves out retired ones and does not require the rest", () => {
    const r = coerceSourcedAttributes({ cost_center: "4100", grade: "7", contractor: "false", level: null, old: "x" }, defs, "HUMAN");
    expect(r).toEqual({ values: { cost_center: "4100", grade: 7, contractor: false, level: null } });
  });

  it("reports an invalid value instead of applying part of the record", () => {
    expect(coerceSourcedAttributes({ grade: "seven" }, defs, "HUMAN")).toMatchObject({ invalid: expect.stringMatching(/grade: must be a number/) });
    expect(coerceSourcedAttributes({ level: "L9" }, defs, "HUMAN")).toMatchObject({ invalid: expect.stringMatching(/level: one of L1, L2/) });
  });

  it("an owning source sets its attributes with provenance; a higher-precedence one wins; others only fill blanks", () => {
    const set = mergeSourcedAttributes({ cost_center: "1000" }, {}, { cost_center: "4100" }, hr, at);
    expect(set.changes).toEqual({ cost_center: "4100" });
    expect(set.provenance["attributes.cost_center"]).toEqual({ sourceId: "hr", priority: 10, at });

    const blocked = mergeSourcedAttributes({ cost_center: "4100" }, { "attributes.cost_center": { sourceId: "hr", priority: 10, at } }, { cost_center: "9" }, dir, at);
    expect(blocked.changes).toEqual({});
    expect(blocked.skipped).toEqual([{ field: "cost_center", reason: "higher_precedence" }]);

    expect(mergeSourcedAttributes({}, {}, { grade: 7 }, sheet, at).changes).toEqual({ grade: 7 });
    expect(mergeSourcedAttributes({ grade: 5 }, {}, { grade: 7 }, sheet, at).changes).toEqual({});
  });
});
