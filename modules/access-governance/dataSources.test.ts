// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServer: vi.fn(), supabaseServiceRole: vi.fn() }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn() }));

import { reachByDataSource, validateDataSourceInput } from "./dataSources";
import { dataFields } from "./grants";

describe("validateDataSourceInput (ACCESS-P0-13)", () => {
  it("trims and keeps the known fields, dropping a smuggled tenant", () => {
    const v = validateDataSourceInput({ name: "  Snowflake CustomerDB ", kind: "warehouse", classification: " restricted ", tenantId: "other" });
    expect(v).toEqual({ name: "Snowflake CustomerDB", kind: "warehouse", applicationId: null, classification: "restricted", owner: null, description: null, externalRef: null });
    expect(v).not.toHaveProperty("tenantId");
  });

  it("rejects what the database would", () => {
    expect(() => validateDataSourceInput({ kind: "database" })).toThrow(/name/);
    expect(() => validateDataSourceInput({ name: "x", kind: "spreadsheet" })).toThrow(/kind/);
    expect(() => validateDataSourceInput({ name: "x".repeat(201), kind: "api" })).toThrow(/name/);
    expect(() => validateDataSourceInput({ name: "x", kind: "api", applicationId: "not-a-uuid" })).toThrow(/applicationId/);
    expect(() => validateDataSourceInput({ name: "x", kind: "api", classification: 7 })).toThrow(/classification/);
    expect(() => validateDataSourceInput([])).toThrow(/object/);
  });
});

describe("reachByDataSource — CAN per data source", () => {
  it("counts linked entitlements and the distinct agents currently holding one, ignoring revoked grants", () => {
    const reach = reachByDataSource([
      { id: "e1", data_source_id: "ds1", access_grants: [{ revoked_at: null, accounts: { agent_id: "a2" } }, { revoked_at: null, accounts: { agent_id: "a1" } }] },
      { id: "e2", data_source_id: "ds1", access_grants: [{ revoked_at: null, accounts: { agent_id: "a1" } }, { revoked_at: "2026-09-01T00:00:00Z", accounts: { agent_id: "a3" } }] },
      { id: "e3", data_source_id: "ds2", access_grants: [] },
    ]);
    expect(reach.get("ds1")).toEqual({ entitlementCount: 2, agentIds: ["a1", "a2"] });
    expect(reach.get("ds2")).toEqual({ entitlementCount: 1, agentIds: [] });
  });
});

describe("dataFields — effective access carries the data source", () => {
  const ent = { application_id: "app", name: "READ", privilege_level: "standard", applications: { name: "Snowflake" } };
  it("the entitlement's own classification wins; the data source's fills in when it has none", () => {
    const ds = { id: "ds1", name: "CustomerDB", classification: "pii" };
    expect(dataFields({ ...ent, data_classification: "financial", data_sources: ds })).toEqual({ dataClassification: "financial", dataSource: ds });
    expect(dataFields({ ...ent, data_classification: null, data_sources: ds })).toEqual({ dataClassification: "pii", dataSource: ds });
    expect(dataFields({ ...ent, data_classification: null, data_sources: null })).toEqual({ dataClassification: null, dataSource: null });
  });
});
