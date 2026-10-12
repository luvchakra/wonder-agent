import { describe, expect, it } from "vitest";
import { correlate, normalizeRecord, parseCsv, planLeavers, validateMappings, validateSourceConfig, type NormalizedSourceRecord } from "./identitySourceRules";
import { coerceSourcedAttributes, mergeSourcedAttributes, mergeSourcedFields, planDisagreements, planRevert } from "@/modules/agent-identity/sourcedMerge";

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

  it("WID-H01: a single match on an identity that has left goes to review, not an automatic link", () => {
    const withLeaver = [...index, { id: "i4", email: "back@example.test", username: "back", displayName: "Back", startDate: null, status: "terminated" }, { id: "i5", email: "on@example.test", username: "on", displayName: "On", startDate: null, status: "active" }];
    expect(correlate(rec({ email: "back@example.test" }), [{ kind: "email" }], withLeaver, null, new Set())).toMatchObject({ kind: "ambiguous", candidateIds: ["i4"], reason: expect.stringMatching(/has left \(terminated\)/) });
    expect(correlate(rec({ email: "on@example.test" }), [{ kind: "email" }], withLeaver, null, new Set())).toMatchObject({ kind: "matched", identityId: "i5" });
    // A record the source already links keeps its link, whatever the identity's status.
    expect(correlate(rec({ email: "back@example.test" }), [{ kind: "email" }], withLeaver, "i4", new Set())).toEqual({ kind: "linked", identityId: "i4" });
  });

  it("WID-H01: a record is never matched again by itself to an identity it was unlinked from; a person decides", () => {
    const rejected = new Set(["i1"]);
    expect(correlate(rec({ email: "ada@example.test" }), [{ kind: "email" }], index, null, new Set(), rejected)).toEqual({
      kind: "ambiguous",
      candidateIds: ["i1"],
      reason: expect.stringMatching(/unlinked from/),
    });
    // Another identity matching alongside the rejected one is the match.
    expect(correlate(rec({ email: "twin@example.test" }), [{ kind: "email" }], index, null, new Set(), new Set(["i2"]))).toMatchObject({ kind: "matched", identityId: "i3" });
    // Without a rejection, nothing changes.
    expect(correlate(rec({ email: "ada@example.test" }), [{ kind: "email" }], index, null, new Set())).toMatchObject({ kind: "matched", identityId: "i1" });
  });

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
    // WID-H01: the disagreement is kept, with both values and the source that won.
    expect(r.disagreements).toEqual([{ field: "department", kept: "Finance", keptSourceId: "hr", incoming: "Sales" }]);
  });

  it("WID-H01: agreeing, owning the field, or only filling a blank is not a disagreement", () => {
    const owner = { department: { sourceId: "hr", priority: 10, at } };
    expect(mergeSourcedFields({ department: "Finance" }, owner, { department: "Finance" }, dir, at).disagreements).toEqual([]);
    expect(mergeSourcedFields({ department: "Finance" }, owner, { department: "Ops" }, hr, at).disagreements).toEqual([]);
    expect(mergeSourcedFields({ location: "Bergen" }, {}, { location: "Oslo" }, dir, at).disagreements).toEqual([]);
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
    expect(blocked.disagreements).toEqual([{ field: "cost_center", kept: "4100", keptSourceId: "hr", incoming: "9" }]);

    expect(mergeSourcedAttributes({}, {}, { grade: 7 }, sheet, at).changes).toEqual({ grade: 7 });
    expect(mergeSourcedAttributes({ grade: 5 }, {}, { grade: 7 }, sheet, at).changes).toEqual({});
  });
});

describe("planDisagreements (WID-H01, owner decision)", () => {
  const open = (id: string, field: string, otherSourceId: string, otherValue: string | null, keptValue = "Finance") => ({ id, field, keptValue, keptSourceId: "hr", otherValue, otherSourceId });
  const lost = (field: string, kept: unknown, incoming: unknown) => ({ field, kept, keptSourceId: "hr", incoming });

  it("opens a new disagreement and refreshes one already open from the same source", () => {
    const r = planDisagreements([open("c1", "title", "dir", "Analyst")], "dir", ["department", "title"], [lost("department", "Finance", "Marketing"), lost("title", "CFO", "Lead")], {});
    expect(r.insert).toEqual([{ field: "department", keptValue: "Finance", keptSourceId: "hr", otherValue: "Marketing" }]);
    expect(r.update).toEqual([{ id: "c1", keptValue: "CFO", keptSourceId: "hr", otherValue: "Lead" }]);
    expect(r.resolve).toEqual([]);
  });

  it("resolves one from this source when it sends the field and no longer loses it; leaves one it did not send", () => {
    const r = planDisagreements([open("c1", "department", "dir", "Marketing"), open("c2", "title", "dir", "Lead")], "dir", ["department"], [], {});
    expect(r).toEqual({ insert: [], update: [], resolve: ["c1"] });
  });

  it("when the owning source writes the field, the other source's disagreement takes the new value, or resolves when they now agree", () => {
    const rows = [open("c1", "department", "dir", "Marketing"), open("c2", "title", "dir", "Lead"), open("c3", "location", "dir", "Oslo")];
    const r = planDisagreements(rows, "hr", ["department", "title"], [], { department: "Marketing", title: "CEO" });
    expect(r.resolve).toEqual(["c1"]);
    expect(r.update).toEqual([{ id: "c2", keptValue: "CEO", keptSourceId: "hr", otherValue: "Lead" }]);
  });

  it("keeps custom attribute values as text, under attributes.<name>", () => {
    const r = planDisagreements([], "dir", ["attributes.grade"], [lost("attributes.grade", 7, 9)], {});
    expect(r.insert).toEqual([{ field: "attributes.grade", keptValue: "7", keptSourceId: "hr", otherValue: "9" }]);
  });
});

describe("planRevert (WID-H01, unlink with undo)", () => {
  const at = (m: number) => `2026-10-12T10:${String(m).padStart(2, "0")}:00Z`;
  const hr = { sourceId: "hr", priority: 10, at: at(0) };
  const change = (id: string, field: string, oldValue: unknown, newValue: unknown, m: number, oldProvenance: typeof hr | null = null) => ({ id, field, oldValue, newValue, oldProvenance, changedAt: at(m) });

  it("restores each field to its value before the record's first change, with that value's provenance", () => {
    const r = planRevert(
      [change("c2", "department", "Sales", "Marketing", 2), change("c1", "department", "Ops", "Sales", 1, hr), change("c3", "attributes.grade", null, 7, 1)],
      { department: "Marketing", "attributes.grade": 7 },
    );
    expect(r.restore).toEqual([
      { field: "department", value: "Ops", provenance: hr },
      { field: "attributes.grade", value: null, provenance: null },
    ]);
    expect(r.kept).toEqual([]);
    expect(r.undone.sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("keeps a field that changed since (another source or a person), and still marks it undone", () => {
    const r = planRevert([change("c1", "title", null, "Analyst", 1), change("c2", "status", "active", "inactive", 1)], { title: "Lead", status: "inactive" });
    expect(r.restore).toEqual([{ field: "status", value: "active", provenance: null }]);
    expect(r.kept).toEqual(["title"]);
    expect(r.undone.sort()).toEqual(["c1", "c2"]);
  });

  it("restores nothing when the record changed nothing (it created the identity)", () => {
    expect(planRevert([], { department: "Finance" })).toEqual({ restore: [], kept: [], undone: [] });
  });
});
