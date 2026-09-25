// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockNotify = vi.fn();
vi.mock("@/modules/operations/service", () => ({
  notify: (event: unknown) => mockNotify(event),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

let ownerRows: { id: string; tenant_id: string; agent_id: string; owner_type: string; user_id: string; removed_at: string | null }[] = [];

function ownersTable() {
  return {
    select: () => ({
      eq: (_c1: string, tenantId: string) => ({
        eq: (_c2: string, agentId: string) => ({
          is: () => ({
            data: ownerRows.filter((r) => r.tenant_id === tenantId && r.agent_id === agentId && r.removed_at === null),
            error: null,
          }),
        }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: (_c1: string, rowId: string) => ({
        eq: (_c2: string, tenantId: string) => {
          const row = ownerRows.find((r) => r.id === rowId && r.tenant_id === tenantId);
          if (row) Object.assign(row, patch);
          return { error: null };
        },
      }),
    }),
  };
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ from: () => ownersTable() }),
}));

import { assignOwner, removeOwner, reviewOwnership } from "./owners";

describe("removeOwner — OPERATIONS-P0-02.2's ownership_missing trigger (2026-09-19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerRows = [
      { id: "owner-1", tenant_id: "tenant-a", agent_id: "agent-1", owner_type: "business_owner", user_id: "user-1", removed_at: null },
      { id: "owner-2", tenant_id: "tenant-a", agent_id: "agent-1", owner_type: "technical_owner", user_id: "user-2", removed_at: null },
    ];
  });

  it("notifies (broadcast) when removing the last owner of a required type takes it to zero", async () => {
    await removeOwner("tenant-a", "agent-1", "owner-1", "actor-1");

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        userId: null,
        type: "ownership_missing",
        referenceType: "agent",
        referenceId: "agent-1",
      }),
    );
  });

  it("does not notify when another owner of the same required type remains", async () => {
    ownerRows.push({ id: "owner-3", tenant_id: "tenant-a", agent_id: "agent-1", owner_type: "business_owner", user_id: "user-3", removed_at: null });

    await removeOwner("tenant-a", "agent-1", "owner-1", "actor-1");

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not notify when the removed owner was a non-required type (e.g. iam_owner)", async () => {
    ownerRows.push({ id: "owner-4", tenant_id: "tenant-a", agent_id: "agent-1", owner_type: "iam_owner", user_id: "user-4", removed_at: null });

    await removeOwner("tenant-a", "agent-1", "owner-4", "actor-1");

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("still writes the audit event and performs the removal even when it doesn't trigger a notification", async () => {
    ownerRows.push({ id: "owner-3", tenant_id: "tenant-a", agent_id: "agent-1", owner_type: "business_owner", user_id: "user-3", removed_at: null });

    await removeOwner("tenant-a", "agent-1", "owner-1", "actor-1");

    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agent.owner_changed" }));
    expect(ownerRows.find((r) => r.id === "owner-1")?.removed_at).not.toBeNull();
  });
});

describe("IDENTITY-P0-13 — delegated owners and the ownership review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerRows = [
      { id: "owner-1", tenant_id: "tenant-a", agent_id: "agent-1", owner_type: "business_owner", user_id: "user-1", removed_at: null },
    ];
  });

  it("refuses a delegated owner with no expiry, a past expiry or one more than a year out, before touching the database", async () => {
    const day = 24 * 60 * 60 * 1000;
    await expect(assignOwner("tenant-a", "agent-1", "delegated_owner", "user-3", "actor-1")).rejects.toMatchObject({ status: 400 });
    await expect(
      assignOwner("tenant-a", "agent-1", "delegated_owner", "user-3", "actor-1", { expiresAt: new Date(Date.now() - day).toISOString() }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      assignOwner("tenant-a", "agent-1", "delegated_owner", "user-3", "actor-1", { expiresAt: new Date(Date.now() + 400 * day).toISOString() }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      assignOwner("tenant-a", "agent-1", "delegated_owner", "user-3", "actor-1", { expiresAt: "not a date" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("will not confirm ownership while a required owner is missing, and records nothing", async () => {
    await expect(reviewOwnership("tenant-a", "actor-1", "agent-1")).rejects.toMatchObject({
      status: 412,
      message: expect.stringContaining("technical owner"),
    });
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
