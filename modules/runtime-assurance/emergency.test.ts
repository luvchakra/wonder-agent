// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
let rows: Row[] = [];
let audits: Row[] = [];
let insertError: { code: string; message: string } | null = null;

function query() {
  const filters: Array<[string, unknown]> = [];
  let pendingInsert: Row | null = null;
  let pendingUpdate: Row | null = null;
  const match = () => rows.filter((r) => filters.every(([c, v]) => (v === null ? r[c] == null : r[c] === v)));
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
    is: (c: string, v: unknown) => (filters.push([c, v]), chain),
    insert: (r: Row) => ((pendingInsert = r), chain),
    update: (r: Row) => ((pendingUpdate = r), chain),
    maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
    single: async () => {
      if (pendingInsert) {
        if (insertError) return { data: null, error: insertError };
        const row = { id: `c${rows.length + 1}`, engaged_at: "2026-09-25T00:00:00Z", lifted_at: null, lifted_by: null, lift_reason: null, ...pendingInsert };
        rows.push(row);
        return { data: row, error: null };
      }
      const row = match()[0];
      if (row && pendingUpdate) Object.assign(row, pendingUpdate);
      return { data: row ?? null, error: null };
    },
    then: (resolve: (v: unknown) => void) => resolve({ data: match(), error: null }),
  };
  return chain;
}

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: query }), supabaseServer: async () => ({ from: query }) }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: async (e: Row) => void audits.push(e) }));

import { engageEmergencyControl, liftEmergencyControl, loadActiveEmergencyState, toEmergencyState } from "./emergency";

beforeEach(() => {
  rows = [];
  audits = [];
  insertError = null;
});

describe("emergency controls — RUNTIME-P0-18", () => {
  it("folds active rows into the decision engine's state", () => {
    expect(
      toEmergencyState([
        { control_type: "kill_switch", target: null },
        { control_type: "tool_suspension", target: "delete_customer" },
        { control_type: "mcp_server_suspension", target: "crm" },
        { control_type: "session_termination", target: "s1" },
      ]),
    ).toEqual({ killSwitch: true, suspendedTools: ["delete_customer"], suspendedMcpServers: ["crm"], terminatedSessions: ["s1"] });
  });

  it("engaging requires a valid type, a reason, and a target except for the kill switch; it is audited", async () => {
    await expect(engageEmergencyControl("t-a", "u1", { controlType: "nuke", reason: "x" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(engageEmergencyControl("t-a", "u1", { controlType: "kill_switch", reason: " " })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(engageEmergencyControl("t-a", "u1", { controlType: "tool_suspension", reason: "x" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const c = await engageEmergencyControl("t-a", "u1", { controlType: "kill_switch", target: "ignored", reason: "incident 42" });
    expect(c).toMatchObject({ controlType: "kill_switch", target: null, active: true, tenantId: "t-a" });
    expect(audits[0]).toMatchObject({ action: "runtime.emergency_control_engaged", tenantId: "t-a", actorId: "u1" });
  });

  it("an already-engaged control is a 409, not a duplicate", async () => {
    insertError = { code: "23505", message: "dup" };
    await expect(engageEmergencyControl("t-a", "u1", { controlType: "kill_switch", reason: "again" })).rejects.toMatchObject({ status: 409 });
  });

  it("the gateway reads only the key's tenant's active controls", async () => {
    await engageEmergencyControl("t-a", "u1", { controlType: "tool_suspension", target: "x", reason: "r" });
    await engageEmergencyControl("t-b", "u2", { controlType: "kill_switch", reason: "r" });
    expect(await loadActiveEmergencyState("t-a")).toEqual({ killSwitch: false, suspendedTools: ["x"], suspendedMcpServers: [], terminatedSessions: [] });
  });

  it("lifting needs a reason, is tenant-scoped and audited, and the control stops applying", async () => {
    const c = await engageEmergencyControl("t-a", "u1", { controlType: "kill_switch", reason: "r" });
    await expect(liftEmergencyControl("t-b", "u2", c.id, "not yours")).rejects.toMatchObject({ code: "CONTROL_NOT_FOUND" });
    await expect(liftEmergencyControl("t-a", "u1", c.id, "")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const lifted = await liftEmergencyControl("t-a", "u1", c.id, "resolved");
    expect(lifted.active).toBe(false);
    expect(audits.at(-1)).toMatchObject({ action: "runtime.emergency_control_lifted" });
    expect((await loadActiveEmergencyState("t-a")).killSwitch).toBe(false);
  });
});
