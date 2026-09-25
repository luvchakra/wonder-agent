// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * IDENTITY-P0-13 — lifecycle gates that read the agent's contract: a
 * production approval is an approver's call, and an agent goes live only
 * under a contract that has not expired and allows its environment.
 */

vi.mock("@/modules/operations/service", () => ({ notify: vi.fn() }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn() }));
vi.mock("./owners", () => ({ listOwners: vi.fn(async () => []) }));

let rows: Record<string, unknown> = {};
const updates: string[] = [];

/** A chainable query whose terminal read returns the row set for the table. */
function table(name: string) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: rows[name] ?? null, error: null });
  q.update = () => {
    updates.push(name);
    return q;
  };
  q.insert = async () => ({ error: null });
  q.single = async () => ({ data: rows[name] ?? null, error: null });
  return q;
}

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: (name: string) => table(name) }) }));

import { transitionAgentLifecycle } from "./lifecycle";

const agentRow = (over: Record<string, unknown>) => ({
  id: "agent-1",
  tenant_id: "tenant-a",
  agent_name: "FinanceBot",
  agent_type: "workflow",
  environment: "production",
  criticality: "medium",
  status: "registered",
  lifecycle_state: "REGISTERED",
  ...over,
});
const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const owner = { actorType: "user" as const, actorId: "user-1", roles: ["AGENT_OWNER"] };

describe("IDENTITY-P0-13 lifecycle contract gates", () => {
  beforeEach(() => {
    updates.length = 0;
    rows = { agent_owners: { id: "owner-row" }, agent_contracts: { id: "c1", allowed_environments: [], expires_at: future } };
  });

  it("an owner cannot approve a production agent; only an approver role can", async () => {
    rows.agents = agentRow({});
    await expect(transitionAgentLifecycle("tenant-a", "agent-1", "APPROVED", "go", owner)).rejects.toMatchObject({
      status: 412,
      message: expect.stringContaining("production"),
    });
    expect(updates).toEqual([]);
  });

  it("an owner can still approve a staging agent", async () => {
    rows.agents = agentRow({ environment: "staging" });
    await transitionAgentLifecycle("tenant-a", "agent-1", "APPROVED", "go", owner);
    expect(updates).toContain("agents");
  });

  it("refuses approval under an expired contract", async () => {
    rows.agents = agentRow({});
    rows.agent_contracts = { id: "c1", allowed_environments: [], expires_at: past };
    await expect(
      transitionAgentLifecycle("tenant-a", "agent-1", "APPROVED", "go", { actorType: "user", actorId: "u", roles: ["TENANT_SUPER_ADMIN"] }),
    ).rejects.toMatchObject({ status: 412, message: expect.stringContaining("expired") });
  });

  it("refuses going live when the contract does not allow the agent's environment", async () => {
    rows.agents = agentRow({ lifecycle_state: "PROVISIONED", status: "provisioned" });
    rows.agent_contracts = { id: "c1", allowed_environments: ["staging"], expires_at: null };
    await expect(
      transitionAgentLifecycle("tenant-a", "agent-1", "ACTIVE", "go", { actorType: "user", actorId: "u", roles: ["TENANT_SUPER_ADMIN"] }),
    ).rejects.toMatchObject({ status: 412, message: expect.stringContaining("production environment") });
    expect(updates).toEqual([]);
  });

  it("refuses going live with no active contract", async () => {
    rows.agents = agentRow({ lifecycle_state: "PROVISIONED", status: "provisioned" });
    delete rows.agent_contracts;
    await expect(
      transitionAgentLifecycle("tenant-a", "agent-1", "ACTIVE", "go", { actorType: "user", actorId: "u", roles: ["TENANT_SUPER_ADMIN"] }),
    ).rejects.toMatchObject({ status: 412, message: "agent contract required" });
  });
});
