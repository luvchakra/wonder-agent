// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ORG = "aaaaaaaa-1610-4000-8000-000000000001";
const ENV = "aaaaaaaa-1610-4000-8000-000000000002";

// The caller's own view (my_managed_organizations, run as the caller).
let managed: Record<string, unknown>[] = [];
const sessionRpc = vi.fn(async () => ({ data: managed, error: null }));

// Service-role writes, recorded.
const writes: { table: string; op: string; values?: unknown }[] = [];
let orderInsert: { data: unknown; error: { code: string } | null } = { data: { id: "order-1" }, error: null };
let createResult: { data: unknown; error: { code: string; message: string } | null } = { data: ENV, error: null };
const prices = [
  { id: "pro_month_usd", plan: "pro", billing_interval: "month", currency: "USD", unit_amount: 49900, tax_behavior: "exclusive", active: true },
  { id: "pro_month_inr", plan: "pro", billing_interval: "month", currency: "INR", unit_amount: 3999900, tax_behavior: "inclusive", active: true },
];
function from(table: string) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain,
    eq: chain,
    order: chain,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => (table === "environment_orders" ? orderInsert : { data: { slug: "acme-test" }, error: null }),
    insert: (values: unknown) => {
      writes.push({ table, op: "insert", values });
      return table === "subscriptions" ? Promise.resolve({ error: null }) : b;
    },
    update: (values: unknown) => {
      writes.push({ table, op: "update", values });
      return b;
    },
    then: (resolve: (v: unknown) => void) => resolve(table === "billing_prices" ? { data: prices, error: null } : { data: null, error: null }),
  });
  return b;
}
const serviceRpc = vi.fn(async () => createResult);
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ rpc: sessionRpc }),
  supabaseServiceRole: () => ({ from, rpc: serviceRpc }),
}));
const audits: Record<string, unknown>[] = [];
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn(async (e: Record<string, unknown>) => void audits.push(e)) }));
let providers = { stripe: false, razorpay: false };
vi.mock("./config", () => ({ configuredProviders: () => providers }));
vi.mock("@/modules/platform-admin/service", () => ({
  PLAN_DEFAULTS: { pro: { maxUsers: 25, maxAgents: 50, maxIntegrations: 5, maxRuntimeEventsPerMonth: 250_000, auditRetentionDays: 365 } },
}));

import { orderEnvironment, testPaymentsAvailable } from "./environmentOrders";

beforeEach(() => {
  managed = [{ tenant_id: ORG, name: "Acme", status: "active", environment: "development", parent_tenant_id: null }];
  writes.length = 0;
  audits.length = 0;
  orderInsert = { data: { id: "order-1" }, error: null };
  createResult = { data: ENV, error: null };
  providers = { stripe: false, razorpay: false };
  serviceRpc.mockClear();
});

describe("testPaymentsAvailable (owner decision 2026-10-13)", () => {
  it("only while no payment provider is configured, and can be turned off", () => {
    expect(testPaymentsAvailable({}, { stripe: false, razorpay: false })).toBe(true);
    expect(testPaymentsAvailable({}, { stripe: true, razorpay: false })).toBe(false);
    expect(testPaymentsAvailable({}, { stripe: false, razorpay: true })).toBe(false);
    expect(testPaymentsAvailable({ BILLING_TEST_PAYMENTS: "false" }, { stripe: false, razorpay: false })).toBe(false);
  });
});

describe("orderEnvironment", () => {
  it("records a test-mode order before setting up, then the environment with the plan bought, audited", async () => {
    await expect(orderEnvironment("user-1", ORG, "test", "pro_month_usd")).resolves.toEqual({ environmentTenantId: ENV, slug: "acme-test" });
    expect(writes[0]).toMatchObject({ table: "environment_orders", op: "insert", values: { tenant_id: ORG, environment: "test", payment_mode: "test", plan: "pro", unit_amount: 49900 } });
    expect(serviceRpc).toHaveBeenCalledWith("create_tenant_environment", { p_parent: ORG, p_environment: "test" });
    expect(writes.find((w) => w.table === "subscriptions")).toMatchObject({ values: { tenant_id: ENV, plan: "pro", provider: "manual", price_id: "pro_month_usd" } });
    expect(writes.at(-1)).toMatchObject({ table: "environment_orders", op: "update", values: { status: "fulfilled", environment_tenant_id: ENV } });
    expect(audits.map((a) => [a.action, a.outcome])).toEqual([
      ["billing.environment_ordered", "success"],
      ["billing.environment_setup", "success"],
    ]);
  });

  it("refuses an organization the caller does not own, or one of its environments", async () => {
    await expect(orderEnvironment("user-1", "aaaaaaaa-1610-4000-8000-00000000000f", "test", "pro_month_usd")).rejects.toMatchObject({ status: 404 });
    managed = [{ tenant_id: ORG, name: "Acme (Dev)", status: "active", environment: "development", parent_tenant_id: "aaaaaaaa-1610-4000-8000-000000000009" }];
    await expect(orderEnvironment("user-1", ORG, "test", "pro_month_usd")).rejects.toMatchObject({ status: 404 });
    expect(writes).toEqual([]);
  });

  it("refuses a disabled organization, its own kind, an unknown kind or a price in another currency", async () => {
    await expect(orderEnvironment("user-1", ORG, "development", "pro_month_usd")).rejects.toMatchObject({ status: 409 });
    await expect(orderEnvironment("user-1", ORG, "production", "pro_month_usd")).rejects.toMatchObject({ status: 400 });
    await expect(orderEnvironment("user-1", ORG, "test", "pro_month_inr")).rejects.toMatchObject({ status: 400 });
    managed = [{ ...managed[0], status: "suspended" }];
    await expect(orderEnvironment("user-1", ORG, "test", "pro_month_usd")).rejects.toMatchObject({ status: 409, message: "Enable the organization first" });
    expect(writes).toEqual([]);
  });

  it("takes no test payment once a real provider is configured", async () => {
    providers = { stripe: true, razorpay: false };
    await expect(orderEnvironment("user-1", ORG, "test", "pro_month_usd")).rejects.toMatchObject({ status: 503 });
    expect(writes).toEqual([]);
  });

  it("a second order while one is open is refused (a double click)", async () => {
    orderInsert = { data: null, error: { code: "23505" } };
    await expect(orderEnvironment("user-1", ORG, "test", "pro_month_usd")).rejects.toMatchObject({ status: 409, message: "That environment is already being set up" });
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("a failed set-up marks the order failed and reports it, never success", async () => {
    createResult = { data: null, error: { code: "23505", message: "duplicate" } };
    await expect(orderEnvironment("user-1", ORG, "test", "pro_month_usd")).rejects.toMatchObject({ status: 409 });
    expect(writes.at(-1)).toMatchObject({ table: "environment_orders", op: "update", values: { status: "failed" } });
    expect(audits.at(-1)).toMatchObject({ action: "billing.environment_setup", outcome: "failure" });
  });
});
