import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_FIELDS } from "@/modules/integrations/framework/types";
import { EXPORT_ENTRIES, EXPORT_PERMISSION, IMPORT_PERMISSION, getExportEntry, importColumns, isTableSource, objectActionsFor } from "./exportRegistry";

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

describe("export registry", () => {
  it("has unique keys, a read permission and columns on every entry", () => {
    const keys = EXPORT_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of EXPORT_ENTRIES) {
      expect(e.key).toMatch(/^[a-z0-9-]+$/);
      expect(e.permission).toMatch(/^[a-z_]+\.[a-z_.]+$/);
      expect(e.auditModule).toMatch(/^[a-z_]+$/);
      expect(e.columns.length).toBeGreaterThan(0);
      expect(new Set(e.columns.map((c) => c.header)).size).toBe(e.columns.length);
    }
  });

  it("names only plain table and column identifiers (nothing user-supplied reaches a query)", () => {
    for (const e of EXPORT_ENTRIES) {
      if (!isTableSource(e.source)) continue;
      expect(e.source.table).toMatch(SAFE_IDENT);
      for (const c of e.columns) {
        expect(c.field).toMatch(SAFE_IDENT);
        if (c.fallback) expect(c.fallback).toMatch(SAFE_IDENT);
        if (c.lookup) {
          expect(c.lookup.table).toMatch(SAFE_IDENT);
          expect(c.lookup.label).toMatch(SAFE_IDENT);
        }
      }
      for (const f of e.source.params ?? []) {
        expect(f.column).toMatch(SAFE_IDENT);
        expect(f.allowed.length).toBeGreaterThan(0);
      }
    }
  });

  it("never selects the tenant id, raw payloads or configuration", () => {
    for (const e of EXPORT_ENTRIES) {
      for (const c of e.columns) expect(["tenant_id", "raw", "config", "attributes", "field_provenance"]).not.toContain(c.field);
    }
  });

  it("uses no service-role client in the registry or the export reader", () => {
    for (const file of ["exportRegistry.ts", "exports.ts"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src).not.toMatch(/supabaseServiceRole/);
    }
    const reader = readFileSync(join(__dirname, "exports.ts"), "utf8");
    expect(reader).toMatch(/\.eq\("tenant_id", tenantId\)/);
  });

  it("writes importable kinds under canonical field names, so an export re-imports", () => {
    for (const e of EXPORT_ENTRIES) {
      if (!e.importKind) continue;
      const canon = CANONICAL_FIELDS[e.importKind];
      const allowed = new Set([...canon.required, ...canon.optional]);
      for (const c of e.columns) expect(allowed.has(c.header)).toBe(true);
      for (const r of canon.required) expect(e.columns.map((c) => c.header)).toContain(r);
    }
  });

  it("derives the template header from the framework's canonical fields", () => {
    expect(importColumns("application")).toEqual({ required: ["externalId", "name"], optional: ["category", "description"] });
    expect(importColumns("access_grant").required).toEqual(["externalId", "accountExternalId", "entitlementExternalId"]);
  });

  it("covers every importable kind on some page", () => {
    const kinds = new Set(EXPORT_ENTRIES.map((e) => e.importKind).filter(Boolean));
    expect([...kinds].sort()).toEqual(["access_grant", "account", "application", "entitlement", "identity"]);
  });
});

describe("objectActionsFor — what the Actions menu offers", () => {
  it("offers nothing without the page's read permission", () => {
    expect(objectActionsFor([EXPORT_PERMISSION, IMPORT_PERMISSION], ["agents"])).toEqual({ exports: [], imports: [] });
  });

  it("needs report.export to export", () => {
    expect(objectActionsFor(["agent.read"], ["agents"]).exports).toEqual([]);
    expect(objectActionsFor(["agent.read", EXPORT_PERMISSION], ["agents"]).exports).toEqual([{ label: "Export CSV", href: "/api/v1/exports/agents" }]);
  });

  it("offers import only for importable kinds and only with the import permission", () => {
    expect(objectActionsFor(["agent.read", IMPORT_PERMISSION], ["agents"]).imports).toEqual([]);
    expect(objectActionsFor(["access.read"], ["accounts"]).imports).toEqual([]);
    const [item] = objectActionsFor(["access.read", IMPORT_PERMISSION], ["accounts"]).imports;
    expect(item).toMatchObject({ kind: "account", label: "Import CSV…", templateHref: "/api/v1/exports/accounts?template=1" });
    expect(item!.required).toEqual(["externalId"]);
  });

  it("labels each object when a page offers several", () => {
    const a = objectActionsFor(["access.read", EXPORT_PERMISSION, IMPORT_PERMISSION], ["applications", "entitlements", "access-grants"]);
    expect(a.exports.map((e) => e.label)).toEqual(["Export applications", "Export entitlements", "Export access grants"]);
    expect(a.imports.map((i) => i.kind)).toEqual(["application", "entitlement", "access_grant"]);
  });

  it("passes only allowed page filters to the export link", () => {
    const perms = ["identity.read", EXPORT_PERMISSION];
    expect(objectActionsFor(perms, ["people"], { status: "active" }).exports[0]!.href).toBe("/api/v1/exports/people?status=active");
    expect(objectActionsFor(perms, ["people"], { status: "x&tenant_id=1" }).exports[0]!.href).toBe("/api/v1/exports/people");
  });

  it("ignores unknown keys", () => {
    expect(getExportEntry("nope")).toBeNull();
    expect(objectActionsFor(["agent.read", EXPORT_PERMISSION], ["nope"]).exports).toEqual([]);
  });
});
