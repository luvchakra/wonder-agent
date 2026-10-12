// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WID-H07 erasure (owner decision "identifiers only"): what erasure does to
 * the records outside the identity, checked against a recording stub of the
 * service-role client. Every statement must carry the tenant filter (§14).
 */

type Call = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };
const calls: Call[] = [];

const TENANT = "tenant-1";
const PERSON = { id: "identity-1", email: "Ann@Example.com", username: "ann" };

function respond(call: Call): { data: unknown; error: null; count?: number } {
  const { table, op } = call;
  if (table === "identities" && op === "select") return { data: [PERSON], error: null };
  if (table === "identities" && op === "update") return { data: [{ id: PERSON.id }], error: null };
  if (table === "accounts" && op === "update")
    return { data: [{ id: "acc-1", status: "active", missing_from_source_at: null }, { id: "acc-2", status: "disabled", missing_from_source_at: null }], error: null };
  if (op === "delete") return { data: null, error: null, count: 2 };
  if (table === "connector_write_operations" && op === "select") {
    const byEmail = call.filters.find(([, col]) => col === "target->>email");
    return byEmail
      ? { data: [{ id: "write-1", target: { email: "ann@example.com", displayName: "Ann Lee" } }], error: null }
      : { data: [{ id: "write-1", target: { email: "ann@example.com", displayName: "Ann Lee" } }, { id: "write-2", target: { username: "ann", account: "A-1" } }], error: null };
  }
  if (table === "identity_source_links") return { data: null, error: null, count: 1 };
  return { data: [], error: null };
}

function builder(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === "update" || name === "delete") {
      call.op = name;
      call.payload = args[0];
    } else if (name !== "select") {
      call.filters.push([name, String(args[0]), args[1]]);
    }
    return b;
  };
  for (const m of ["select", "update", "delete", "eq", "neq", "in", "ilike", "lt"]) b[m] = chain(m);
  b.then = (resolve: (v: unknown) => unknown) => resolve(respond(call));
  return b;
}

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/users/users", () => ({ changeUserStatus: vi.fn() }));

const { pseudonymiseRemovedMember, eraseSubject } = await import("./subjectData");

beforeEach(() => {
  calls.length = 0;
});

const tenantFiltered = (c: Call) => c.filters.some(([op, col, v]) => op === "eq" && col === "tenant_id" && v === TENANT);

describe("erasure of the records that name a person (WID-H07)", () => {
  it("pseudonymises the person, their account names and the connector writes that named them", async () => {
    expect(await pseudonymiseRemovedMember(TENANT, "user-1")).toBe(1);

    for (const c of calls) expect(tenantFiltered(c), `${c.op} ${c.table}`).toBe(true);

    const people = calls.find((c) => c.table === "identities" && c.op === "select")!;
    expect(people.filters).toContainEqual(["in", "identity_type", ["HUMAN", "EXTERNAL"]]);

    const identity = calls.find((c) => c.table === "identities" && c.op === "update")!;
    expect(identity.payload).toMatchObject({ email: null, username: null, source_native_id: null, correlation_key: null });

    const accounts = calls.find((c) => c.table === "accounts")!;
    expect(accounts.op).toBe("update");
    expect(Object.keys(accounts.payload as object)).not.toContain("external_account_ref");
    expect((accounts.payload as { account_name: string }).account_name).toMatch(/^erased-/);

    expect(calls.filter((c) => c.op === "delete").map((c) => c.table).sort()).toEqual(["identity_source_changes", "identity_source_conflicts"]);

    const writes = calls.filter((c) => c.table === "connector_write_operations" && c.op === "update");
    expect(writes).toHaveLength(2);
    const label = (accounts.payload as { account_name: string }).account_name;
    const targets = Object.fromEntries(writes.map((w) => [w.filters.find(([, col]) => col === "id")![2], (w.payload as { target: unknown }).target]));
    expect(targets["write-1"]).toEqual({ email: label, displayName: label });
    expect(targets["write-2"]).toEqual({ username: label, account: "A-1" });
  });

  it("looks up connector writes by the person's email (escaped) and login", async () => {
    await pseudonymiseRemovedMember(TENANT, "user-1");
    const lookups = calls.filter((c) => c.table === "connector_write_operations" && c.op === "select");
    expect(lookups.flatMap((c) => c.filters.filter(([, col]) => col.startsWith("target->>")))).toEqual([
      ["ilike", "target->>email", "ann@example.com"],
      ["in", "target->>username", ["ann"]],
    ]);
  });

  it("reports what a source or system still holds", async () => {
    const summary = await eraseSubject(TENANT, "approver-1", { userId: null, email: "ann@example.com" }, "request-1");
    expect(summary).toMatchObject({
      identitiesPseudonymised: 1,
      accountsPseudonymised: 2,
      sourceValuesDeleted: 4,
      connectorWritesPseudonymised: 2,
      stillHeldAtSource: { sourceRecords: 1, accounts: 1 },
    });
    for (const c of calls) expect(tenantFiltered(c), `${c.op} ${c.table}`).toBe(true);
  });
});
