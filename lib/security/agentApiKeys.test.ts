// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let audits: Row[] = [];
let inserted: Row[] = [];
let updates: Array<{ table: string; values: Row; filters: Array<[string, unknown]> }> = [];

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let pendingInsert: Row | null = null;
  let pendingUpdate: Row | null = null;
  const matches = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return chain;
    },
    order: () => chain,
    limit: async () => ({ data: matches(), error: null }),
    maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
    insert: (row: Row) => {
      pendingInsert = { id: `key-${inserted.length + 1}`, created_at: "2026-09-25T00:00:00Z", last_used_at: null, revoked_at: null, revoked_reason: null, ...row };
      inserted.push(pendingInsert);
      return chain;
    },
    update: (values: Row) => {
      pendingUpdate = values;
      return chain;
    },
    single: async () => {
      if (pendingInsert) return { data: pendingInsert, error: null };
      if (pendingUpdate) {
        updates.push({ table, values: pendingUpdate, filters: [...filters] });
        const row = matches()[0];
        return { data: row ? { ...row, ...pendingUpdate } : null, error: null };
      }
      return { data: matches()[0] ?? null, error: null };
    },
    then: (resolve: (v: unknown) => void) => {
      if (pendingUpdate) updates.push({ table, values: pendingUpdate, filters: [...filters] });
      resolve({ data: null, error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({ from: query }),
  supabaseServer: async () => ({ from: query }),
}));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: async (e: Row) => void audits.push(e) }));

import {
  agentApiKeyStatus,
  bearerAgentKey,
  createAgentApiKey,
  generateAgentApiKey,
  hashAgentApiKey,
  isWellFormedAgentApiKey,
  listAgentApiKeys,
  revokeAgentApiKey,
  verifyAgentApiKey,
} from "./agentApiKeys";

const NOW = new Date("2026-09-25T12:00:00Z");

function keyRow(secret: string, over: Row = {}): Row {
  const base: Row = {
    id: "k1",
    tenant_id: "tenant-a",
    agent_id: "agent-a",
    name: "prod",
    key_prefix: secret.slice(0, 12),
    key_hash: hashAgentApiKey(secret),
    created_by: "user-1",
    created_at: "2026-09-01T00:00:00Z",
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
    revoked_reason: null,
    ...over,
  };
  // verifyAgentApiKey() embeds the key's tenant and agent through their FKs.
  const tenant = tables.tenants.find((t) => t.id === base.tenant_id);
  const agent = tables.agents.find((a) => a.id === base.agent_id);
  return { ...base, tenants: tenant ? { status: tenant.status } : null, agents: agent ? { tenant_id: agent.tenant_id } : null };
}

beforeEach(() => {
  audits = [];
  inserted = [];
  updates = [];
  tables = {
    tenants: [
      { id: "tenant-a", status: "active" },
      { id: "tenant-b", status: "active" },
      { id: "tenant-s", status: "suspended" },
    ],
    agents: [
      { id: "agent-a", tenant_id: "tenant-a" },
      { id: "agent-b", tenant_id: "tenant-b" },
      { id: "agent-s", tenant_id: "tenant-s" },
    ],
    agent_api_keys: [],
  };
});

describe("key material", () => {
  it("generates a well-formed, unique secret whose hash is what gets stored", () => {
    const a = generateAgentApiKey();
    const b = generateAgentApiKey();
    expect(isWellFormedAgentApiKey(a.secret)).toBe(true);
    expect(a.secret).not.toBe(b.secret);
    expect(a.hash).toBe(hashAgentApiKey(a.secret));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.secret.startsWith(a.prefix)).toBe(true);
    // The display prefix is far too short to be the secret.
    expect(a.prefix.length).toBeLessThan(16);
  });

  it("rejects anything not shaped like a key", () => {
    expect(isWellFormedAgentApiKey("")).toBe(false);
    expect(isWellFormedAgentApiKey("wa_ak_short")).toBe(false);
    expect(isWellFormedAgentApiKey("sk_live_" + "x".repeat(43))).toBe(false);
    expect(isWellFormedAgentApiKey(generateAgentApiKey().secret + " ")).toBe(false);
  });

  it("reads a bearer token and nothing else", () => {
    expect(bearerAgentKey(new Headers({ authorization: "Bearer wa_ak_abc" }))).toBe("wa_ak_abc");
    expect(bearerAgentKey(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(bearerAgentKey(new Headers())).toBeNull();
  });

  it("derives status from revocation and expiry", () => {
    expect(agentApiKeyStatus({ revoked_at: null, expires_at: null }, NOW)).toBe("active");
    expect(agentApiKeyStatus({ revoked_at: "2026-09-20T00:00:00Z", expires_at: null }, NOW)).toBe("revoked");
    expect(agentApiKeyStatus({ revoked_at: null, expires_at: "2026-09-25T11:59:59Z" }, NOW)).toBe("expired");
    expect(agentApiKeyStatus({ revoked_at: null, expires_at: "2026-10-01T00:00:00Z" }, NOW)).toBe("active");
  });
});

describe("verifyAgentApiKey — fails closed", () => {
  it("returns the tenant and agent bound to a valid key", async () => {
    const { secret } = generateAgentApiKey();
    tables.agent_api_keys = [keyRow(secret)];
    await expect(verifyAgentApiKey(secret, NOW)).resolves.toEqual({ keyId: "k1", tenantId: "tenant-a", agentId: "agent-a" });
  });

  it("returns null for a malformed or unknown key without trusting anything else", async () => {
    await expect(verifyAgentApiKey(null, NOW)).resolves.toBeNull();
    await expect(verifyAgentApiKey("not-a-key", NOW)).resolves.toBeNull();
    await expect(verifyAgentApiKey(generateAgentApiKey().secret, NOW)).resolves.toBeNull();
  });

  it("returns null for a revoked key", async () => {
    const { secret } = generateAgentApiKey();
    tables.agent_api_keys = [keyRow(secret, { revoked_at: "2026-09-24T00:00:00Z" })];
    await expect(verifyAgentApiKey(secret, NOW)).resolves.toBeNull();
  });

  it("returns null for an expired key", async () => {
    const { secret } = generateAgentApiKey();
    tables.agent_api_keys = [keyRow(secret, { expires_at: "2026-09-25T11:00:00Z" })];
    await expect(verifyAgentApiKey(secret, NOW)).resolves.toBeNull();
  });

  it("returns null once the key's tenant is suspended", async () => {
    const { secret } = generateAgentApiKey();
    tables.agent_api_keys = [keyRow(secret, { tenant_id: "tenant-s", agent_id: "agent-s" })];
    await expect(verifyAgentApiKey(secret, NOW)).resolves.toBeNull();
  });

  it("returns null if the key's agent is not in the key's tenant (cross-tenant binding)", async () => {
    const { secret } = generateAgentApiKey();
    tables.agent_api_keys = [keyRow(secret, { tenant_id: "tenant-a", agent_id: "agent-b" })];
    await expect(verifyAgentApiKey(secret, NOW)).resolves.toBeNull();
  });

  it("refreshes last_used_at, scoped to the key's own tenant", async () => {
    const { secret } = generateAgentApiKey();
    tables.agent_api_keys = [keyRow(secret)];
    await verifyAgentApiKey(secret, NOW);
    // The stamp runs after the response (runAfterResponse); let it settle.
    await new Promise((r) => setTimeout(r, 0));
    const touch = updates.find((u) => u.table === "agent_api_keys");
    expect(touch?.values).toEqual({ last_used_at: NOW.toISOString() });
    expect(touch?.filters).toContainEqual(["tenant_id", "tenant-a"]);
  });
});

describe("issue, list and revoke", () => {
  it("issues a key for an agent in the caller's tenant, stores only the hash, and audits without the secret", async () => {
    const { key, secret } = await createAgentApiKey("tenant-a", "user-1", "agent-a", { name: "prod gateway" });
    expect(isWellFormedAgentApiKey(secret)).toBe(true);
    expect(inserted[0].key_hash).toBe(hashAgentApiKey(secret));
    expect(JSON.stringify(inserted[0])).not.toContain(secret);
    expect(key.status).toBe("active");
    expect(key).not.toHaveProperty("key_hash");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "agent_api_key.created", tenantId: "tenant-a", actorId: "user-1" });
    const auditText = JSON.stringify(audits[0]);
    expect(auditText).not.toContain(secret);
    expect(auditText).not.toContain(hashAgentApiKey(secret));
  });

  it("refuses to issue a key for another tenant's agent", async () => {
    await expect(createAgentApiKey("tenant-a", "user-1", "agent-b", { name: "x" })).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
    expect(inserted).toHaveLength(0);
  });

  it("validates name and expiry", async () => {
    await expect(createAgentApiKey("tenant-a", "user-1", "agent-a", { name: "  " })).rejects.toMatchObject({ code: "INVALID_NAME" });
    await expect(
      createAgentApiKey("tenant-a", "user-1", "agent-a", { name: "x", expiresAt: "2000-01-01" }),
    ).rejects.toMatchObject({ code: "INVALID_EXPIRY" });
  });

  it("lists only the tenant's keys for that agent", async () => {
    const a = generateAgentApiKey();
    const b = generateAgentApiKey();
    tables.agent_api_keys = [keyRow(a.secret), keyRow(b.secret, { id: "k2", tenant_id: "tenant-b", agent_id: "agent-a" })];
    const keys = await listAgentApiKeys("tenant-a", "agent-a");
    expect(keys.map((k) => k.id)).toEqual(["k1"]);
  });

  it("revokes a key and audits it; another tenant cannot revoke it", async () => {
    const { secret } = generateAgentApiKey();
    tables.agent_api_keys = [keyRow(secret)];
    await expect(revokeAgentApiKey("tenant-b", "user-2", "agent-a", "k1", "x")).rejects.toMatchObject({ code: "KEY_NOT_FOUND" });
    const revoked = await revokeAgentApiKey("tenant-a", "user-1", "agent-a", "k1", "rotated");
    expect(revoked.status).toBe("revoked");
    expect(audits.at(-1)).toMatchObject({ action: "agent_api_key.revoked", objectId: "k1" });
  });
});
