import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVENANCE_TABLES } from "./tables";

describe("PROVENANCE_TABLES", () => {
  it("lists exactly the tables migration 0115 gives provenance to", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0115_foundation_record_provenance.sql"), "utf8");
    const block = sql.slice(sql.indexOf("foreach t in array array["), sql.indexOf("] loop"));
    const inMigration = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...PROVENANCE_TABLES].sort()).toEqual([...inMigration].sort());
    expect(new Set(inMigration).size).toBe(inMigration.length);
  });

  it("leaves out the append-only and event tables", () => {
    for (const t of ["audit_logs", "platform_audit_logs", "access_ledger_events", "privacy_consent_records", "billing_invoices", "runtime_events", "connector_traffic"]) {
      expect(PROVENANCE_TABLES).not.toContain(t);
    }
  });
});
