// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ingestRuntimeEvent() writes through the service role, so it must prove
 * every referenced row is the caller's tenant's (CLAUDE.md §14). These
 * tests pin the identity check added 2026-09-25 (codebase-map D2).
 */

type Row = Record<string, string>;
let tables: Record<string, Row[]> = {};
let inserted: Row[] = [];

function query(table: string) {
  const filters: Array<[string, string]> = [];
  const chain = {
    select: () => chain,
    eq: (col: string, val: string) => {
      filters.push([col, val]);
      return chain;
    },
    maybeSingle: async () => ({
      data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
      error: null,
    }),
    insert: (row: Row) => {
      if (table === "runtime_events") inserted.push(row);
      return {
        select: () => ({ single: async () => ({ data: { id: "evt-1", ...row }, error: null }) }),
      };
    },
  };
  return chain;
}

// PLATFORM-P0-12 — feature flags: defaults (every gated capability on,
// gateway observe-only). Flag behaviour itself is tested in
// modules/platform-admin/featureFlags.test.ts and gateway.test.ts.
vi.mock("@/modules/platform-admin/service", () => ({
  requireFeature: async () => undefined,
  getFeatureFlags: async (_t: string, keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, k !== "runtime_enforce"])),
}));

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ from: query }),
  supabaseServiceRole: () => ({ from: query }),
}));
vi.mock("./mappers", () => ({ toRuntimeEvent: (r: Row) => r }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: async () => undefined }));

import { ingestRuntimeEvent } from "./events";

const base = {
  agentId: "agent-a",
  eventTime: new Date().toISOString(),
  source: "mcp" as const,
  action: "read",
  success: true,
};

describe("ingestRuntimeEvent — identity must belong to the tenant and agent", () => {
  beforeEach(() => {
    inserted = [];
    tables = {
      agents: [
        { id: "agent-a", tenant_id: "tenant-a" },
        { id: "agent-a2", tenant_id: "tenant-a" },
      ],
      agent_identities: [
        { id: "ident-a", tenant_id: "tenant-a", agent_id: "agent-a" },
        { id: "ident-a2", tenant_id: "tenant-a", agent_id: "agent-a2" },
        { id: "ident-b", tenant_id: "tenant-b", agent_id: "agent-b" },
      ],
    };
  });

  it("rejects another tenant's identity and writes nothing", async () => {
    await expect(ingestRuntimeEvent("tenant-a", null, { ...base, identityId: "ident-b" })).rejects.toMatchObject({
      status: 404,
      code: "IDENTITY_NOT_FOUND",
    });
    expect(inserted).toHaveLength(0);
  });

  it("rejects an identity of a different agent in the same tenant", async () => {
    await expect(ingestRuntimeEvent("tenant-a", null, { ...base, identityId: "ident-a2" })).rejects.toMatchObject({
      code: "IDENTITY_NOT_FOUND",
    });
    expect(inserted).toHaveLength(0);
  });

  it("accepts the agent's own identity", async () => {
    await ingestRuntimeEvent("tenant-a", null, { ...base, identityId: "ident-a" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ tenant_id: "tenant-a", identity_id: "ident-a" });
  });

  it("accepts an event with no identity", async () => {
    await ingestRuntimeEvent("tenant-a", null, base);
    expect(inserted[0]).toMatchObject({ identity_id: null });
  });
});
