import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { BillingPrice } from "@/lib/shared/types/platform";
import { PLAN_DEFAULTS, getSubscription } from "@/modules/platform-admin/service";
import { configuredProviders } from "./config";
import { toPrice } from "./mappers";
import { defaultCurrencyFor } from "./rules";

/**
 * Owner decisions (2026-10-13): creating another organization stays free;
 * a new environment (development, test, staging) is paid for, at a plan's
 * price, by the organization's owner from "Manage organizations".
 *
 * Until a payment provider is configured, the owner chose test payments:
 * the order is marked paid in test mode (no money moves, no provider is
 * called) and the environment is set up at once. The order records the mode
 * for ever. Once Stripe or Razorpay keys are set, test payments stop and
 * environment checkout through the provider is the recorded follow-up.
 * BILLING_TEST_PAYMENTS=false turns test payments off earlier.
 */
export const ENVIRONMENT_KINDS = ["development", "test", "staging"] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export function testPaymentsAvailable(env: Record<string, string | undefined> = process.env, providers = configuredProviders()): boolean {
  if (env.BILLING_TEST_PAYMENTS === "false") return false;
  return !providers.stripe && !providers.razorpay;
}

/**
 * The organization the caller owns, checked in the database as the caller
 * (is_organization_owner, migration 0161): a top-level, active organization.
 */
async function ownedOrganization(organizationId: string): Promise<{ tenantId: string; name: string; environment: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) throw new ApiError(404, "NOT_FOUND", "Organization not found");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("my_managed_organizations");
  if (error) throw new ApiError(500, "QUERY_FAILED", "Your organizations could not be read");
  const row = ((data ?? []) as { tenant_id: string; name: string; status: string; environment: string; parent_tenant_id: string | null }[]).find((r) => r.tenant_id === organizationId);
  if (!row || row.parent_tenant_id) throw new ApiError(404, "NOT_FOUND", "Organization not found");
  if (row.status !== "active") throw new ApiError(409, "ORGANIZATION_DISABLED", "Enable the organization first");
  return { tenantId: row.tenant_id, name: row.name, environment: row.environment };
}

/** The monthly and yearly prices an environment can be bought at, in the organization's billing currency. */
export async function environmentPrices(organizationId: string): Promise<BillingPrice[]> {
  const org = await ownedOrganization(organizationId);
  const supabase = supabaseServiceRole();
  const [orgSub, { data: profile }, { data: prices, error }] = await Promise.all([
    getSubscription(org.tenantId),
    supabase.from("billing_profiles").select("country").eq("tenant_id", org.tenantId).maybeSingle(),
    supabase.from("billing_prices").select("id, plan, billing_interval, currency, unit_amount, tax_behavior, active").eq("active", true).order("plan").order("billing_interval"),
  ]);
  if (error) throw new ApiError(500, "QUERY_FAILED", "Prices could not be read");
  const currency = profile?.country ? defaultCurrencyFor(profile.country as string) : "USD";
  // Owner decision 2026-10-13: one plan per organization, the same in every
  // environment. An organization on Pro or Max buys environments on that plan.
  const plan = orgSub?.plan === "pro" || orgSub?.plan === "max" ? orgSub.plan : null;
  return (prices ?? []).map(toPrice).filter((p) => p.currency === currency && (!plan || p.plan === plan));
}

/**
 * Buys an environment for an organization and sets it up. Test mode only
 * (see above). The order is written before anything else, idempotent per
 * organization and environment while open (a double click finds it open);
 * a failure is recorded on the order and reported, never shown as success.
 */
export async function orderEnvironment(actorId: string, organizationId: string, environment: string, priceId: string): Promise<{ environmentTenantId: string; slug: string }> {
  if (!ENVIRONMENT_KINDS.includes(environment as EnvironmentKind)) throw new ApiError(400, "INVALID_INPUT", "Choose development, test or staging");
  const org = await ownedOrganization(organizationId);
  if (org.environment === environment) throw new ApiError(409, "ENVIRONMENT_EXISTS", "The organization itself is that environment");
  if (!testPaymentsAvailable()) throw new ApiError(503, "PAYMENTS_UNAVAILABLE", "Online payment for environments is not available yet. Contact support to add one.");
  const price = (await environmentPrices(organizationId)).find((p) => p.id === priceId);
  if (!price) throw new ApiError(400, "INVALID_INPUT", "Choose a plan");

  const supabase = supabaseServiceRole();
  const { data: order, error: orderError } = await supabase
    .from("environment_orders")
    .insert({
      tenant_id: org.tenantId,
      environment,
      price_id: price.id,
      plan: price.plan,
      currency: price.currency,
      unit_amount: price.unitAmount,
      billing_interval: price.interval,
      payment_mode: "test",
      created_by: actorId,
    })
    .select("id")
    .single();
  if (orderError || !order) {
    if (orderError?.code === "23505") throw new ApiError(409, "ORDER_IN_PROGRESS", "That environment is already being set up");
    throw new ApiError(500, "CREATE_FAILED", "The order could not be placed");
  }
  await writeAudit({
    tenantId: org.tenantId,
    actorId,
    actorType: "user",
    action: "billing.environment_ordered",
    objectType: "environment_order",
    objectId: order.id,
    outcome: "success",
    metadata: { environment, priceId: price.id, plan: price.plan, currency: price.currency, unitAmount: price.unitAmount, paymentMode: "test" },
  });

  const fail = async (failure: string, status: number, code: string): Promise<never> => {
    await supabase.from("environment_orders").update({ status: "failed", failure }).eq("id", order.id).eq("tenant_id", org.tenantId);
    await writeAudit({
      tenantId: org.tenantId,
      actorId,
      actorType: "user",
      action: "billing.environment_setup",
      objectType: "environment_order",
      objectId: order.id,
      outcome: "failure",
      metadata: { environment, failure },
    });
    throw new ApiError(status, code, failure);
  };

  const { data: created, error: createError } = await supabase.rpc("create_tenant_environment", { p_parent: org.tenantId, p_environment: environment });
  if (createError || typeof created !== "string") {
    return fail(
      createError?.code === "23505" ? "That environment already exists, or its address is taken" : "The environment could not be set up",
      createError?.code === "23505" ? 409 : 500,
      "SETUP_FAILED",
    );
  }
  const environmentTenantId = created as string;

  const limits = PLAN_DEFAULTS[price.plan];
  const { error: subError } = await supabase.from("subscriptions").insert({
    tenant_id: environmentTenantId,
    plan: price.plan,
    provider: "manual",
    price_id: price.id,
    billing_interval: price.interval,
    currency: price.currency,
    max_users: limits.maxUsers,
    max_agents: limits.maxAgents,
    max_integrations: limits.maxIntegrations,
    max_runtime_events_per_month: limits.maxRuntimeEventsPerMonth,
    audit_retention_days: limits.auditRetentionDays,
  });
  if (subError) return fail("The environment was created but its plan could not be set. Contact support.", 500, "SETUP_INCOMPLETE");

  await supabase
    .from("environment_orders")
    .update({ status: "fulfilled", environment_tenant_id: environmentTenantId, fulfilled_at: new Date().toISOString() })
    .eq("id", order.id)
    .eq("tenant_id", org.tenantId);
  const { data: tenant } = await supabase.from("tenants").select("slug").eq("id", environmentTenantId).single();
  await writeAudit({
    tenantId: environmentTenantId,
    actorId,
    actorType: "user",
    action: "billing.environment_setup",
    objectType: "environment_order",
    objectId: order.id,
    outcome: "success",
    metadata: { organizationId: org.tenantId, environment, plan: price.plan, paymentMode: "test" },
  });
  return { environmentTenantId, slug: (tenant?.slug as string) ?? "" };
}
