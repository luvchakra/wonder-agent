import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVENANCE_TABLES } from "./tables";

describe("PROVENANCE_TABLES", () => {
  it("lists exactly the tables the provenance migrations (0115 and later) give provenance to", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const inMigration = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((sql) => sql.includes("create trigger record_provenance") && sql.includes("foreach t in array array["))
      .flatMap((sql) => [...sql.slice(sql.indexOf("foreach t in array array["), sql.indexOf("] loop")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    expect([...PROVENANCE_TABLES].sort()).toEqual([...inMigration].sort());
    expect(new Set(inMigration).size).toBe(inMigration.length);
  });

  it("leaves out the append-only and event tables", () => {
    for (const t of ["audit_logs", "platform_audit_logs", "access_ledger_events", "privacy_consent_records", "billing_invoices", "runtime_events", "connector_traffic"]) {
      expect(PROVENANCE_TABLES).not.toContain(t);
    }
  });
});
