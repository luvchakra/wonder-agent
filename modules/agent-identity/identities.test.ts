// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Array<Record<string, unknown>> = [];
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "link-1", created_at: "2026-09-25T00:00:00Z", status: "active", ...row }, error: null }) }) };
      },
    }),
  }),
}));
const audits: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: async (e: Record<string, unknown>) => void audits.push(e) }));

import { linkAgentIdentity } from "./identities";

beforeEach(() => {
  inserted.length = 0;
  audits.length = 0;
});

describe("linkAgentIdentity (IDENTITY-P0-14, codebase-map D3)", () => {
  it("stores the confidence the caller states, never a hard-coded one, and audits the link with its basis", async () => {
    const link = await linkAgentIdentity("t1", "a1", "service_account", "svc-finance", "saviynt", { actorId: "u1", confidence: "probable", basis: "Matched by owner email" });
    expect(inserted[0]).toMatchObject({ tenant_id: "t1", agent_id: "a1", confidence: "probable" });
    expect(link.confidence).toBe("probable");
    expect(audits).toEqual([
      expect.objectContaining({
        tenantId: "t1",
        actorId: "u1",
        actorType: "user",
        action: "agent.identity_linked",
        objectType: "agent_identity",
        objectId: "link-1",
        metadata: expect.objectContaining({ confidence: "probable", basis: "Matched by owner email", externalReference: "svc-finance" }),
      }),
    ]);
  });

  it("rejects an unknown confidence before writing anything", async () => {
    await expect(
      linkAgentIdentity("t1", "a1", "service_account", "x", "manual", { actorId: "u1", confidence: "certain" as "confirmed", basis: "x" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(inserted).toEqual([]);
    expect(audits).toEqual([]);
  });
});
