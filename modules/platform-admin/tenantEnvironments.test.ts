// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let rpcResult: { data: unknown; error: { code: string; message: string } | null } = { data: "env-1", error: null };
const rpc = vi.fn(async () => rpcResult);
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ rpc }) }));
const audits: Record<string, unknown>[] = [];
vi.mock("./auditLog", () => ({ writePlatformAudit: vi.fn(async (e: Record<string, unknown>) => void audits.push(e)) }));

import { createTenantEnvironment } from "./tenants";

const PARENT = "aaaaaaaa-1560-4000-8000-000000000001";

beforeEach(() => {
  rpcResult = { data: "env-1", error: null };
  rpc.mockClear();
  audits.length = 0;
});

describe("createTenantEnvironment (owner request 2026-10-13)", () => {
  it("creates the environment in the database and audits it", async () => {
    await expect(createTenantEnvironment("admin-1", PARENT, "development")).resolves.toEqual({ tenantId: "env-1" });
    expect(rpc).toHaveBeenCalledWith("create_tenant_environment", { p_parent: PARENT, p_environment: "development" });
    expect(audits).toEqual([expect.objectContaining({ action: "platform.tenant_environment_created", tenantId: "env-1", result: "success", newValue: { parentTenantId: PARENT, environment: "development" } })]);
  });

  it("refuses an unknown kind or a malformed organization id before touching the database", async () => {
    await expect(createTenantEnvironment("admin-1", PARENT, "production")).rejects.toMatchObject({ status: 400 });
    await expect(createTenantEnvironment("admin-1", "not-a-uuid", "test")).rejects.toMatchObject({ status: 404 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports an existing environment as refused, audited as a failure, never as success", async () => {
    rpcResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    await expect(createTenantEnvironment("admin-1", PARENT, "test")).rejects.toMatchObject({ status: 409, message: "That environment already exists" });
    expect(audits).toEqual([expect.objectContaining({ result: "failure", tenantId: PARENT })]);
  });

  it("does not echo an unexpected database error", async () => {
    rpcResult = { data: null, error: { code: "XX000", message: "internal detail" } };
    await expect(createTenantEnvironment("admin-1", PARENT, "staging")).rejects.toMatchObject({ status: 500, message: "The environment could not be created" });
  });
});
