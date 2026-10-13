import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { Subscription, SubscriptionPlan, SubscriptionStatus } from "@/lib/shared/types/platform";
import { toSubscription } from "./mappers";
import { writePlatformAudit } from "./auditLog";

/**
 * PLATFORM-P0-02.1's own instruction: "exact numbers are a business
 * decision, not an architecture one — pick reasonable defaults... document
 * the chosen numbers in the audit log so the user can adjust them without
 * re-deriving the schema." Chosen here and documented in
 * docs/design/platform-agent-backlog-audit.md.
 *
 * Audit retention (WID-H07, owner decision 2026-10-12): 1 year on Free and
 * Pro, 3 years on Max, 7 years on Enterprise. Never under a year: the
 * purge keeps the last 365 days whatever the plan (migration 0104), and the
 * database refuses less (migration 0143).
 */
export const PLAN_DEFAULTS: Record<SubscriptionPlan, Omit<Subscription, "id" | "tenantId" | "status" | "startedAt" | "renewedAt" | "plan">> = {
  free: { maxUsers: 3, maxAgents: 5, maxIntegrations: 1, maxRuntimeEventsPerMonth: 10_000, auditRetentionDays: 365 },
  pro: { maxUsers: 25, maxAgents: 50, maxIntegrations: 5, maxRuntimeEventsPerMonth: 250_000, auditRetentionDays: 365 },
  max: { maxUsers: 100, maxAgents: 250, maxIntegrations: 20, maxRuntimeEventsPerMonth: 2_000_000, auditRetentionDays: 1095 },
  enterprise: { maxUsers: 1_000_000, maxAgents: 1_000_000, maxIntegrations: 1_000_000, maxRuntimeEventsPerMonth: 1_000_000_000, auditRetentionDays: 2555 },
};

export async function createSubscription(actorId: string, tenantId: string, plan: SubscriptionPlan): Promise<Subscription> {
  const defaults = PLAN_DEFAULTS[plan];
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      tenant_id: tenantId,
      plan,
      max_users: defaults.maxUsers,
      max_agents: defaults.maxAgents,
      max_integrations: defaults.maxIntegrations,
      max_runtime_events_per_month: defaults.maxRuntimeEventsPerMonth,
      audit_retention_days: defaults.auditRetentionDays,
    })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create subscription");

  await writePlatformAudit({ actorId, tenantId, action: "platform.subscription_created", newValue: { plan }, result: "success" });
  return toSubscription(data);
}

export async function getSubscription(tenantId: string): Promise<Subscription | null> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase.from("subscriptions").select().eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toSubscription(data) : null;
}

export async function updateSubscriptionStatus(actorId: string, subscriptionId: string, status: SubscriptionStatus): Promise<Subscription> {
  const supabase = supabaseServiceRole();
  const { data: previous, error: fetchError } = await supabase.from("subscriptions").select().eq("id", subscriptionId).maybeSingle();
  if (fetchError) throw new ApiError(500, "QUERY_FAILED", fetchError.message);
  if (!previous) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND");

  const { data, error } = await supabase
    .from("subscriptions")
    .update({ status, renewed_at: status === "active" ? new Date().toISOString() : previous.renewed_at })
    .eq("id", subscriptionId)
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to update subscription");

  await writePlatformAudit({
    actorId,
    tenantId: previous.tenant_id,
    action: "platform.subscription_status_changed",
    oldValue: { status: previous.status },
    newValue: { status },
    result: "success",
  });

  return toSubscription(data);
}

/**
 * Owner request (2026-10-13): change an organization's plan after it was
 * assigned. A plan the platform assigned by hand (or none yet) changes here,
 * with that plan's limits, audited. A plan billed through Stripe or Razorpay
 * is the provider's to change: that goes through Billing's plan override,
 * which a second administrator approves (CLAUDE.md §18.2, maker-checker).
 */
export async function changePlan(actorId: string, tenantId: string, plan: SubscriptionPlan): Promise<Subscription> {
  if (!(plan in PLAN_DEFAULTS)) throw new ApiError(400, "INVALID_INPUT", "plan: free, pro, max or enterprise");
  const current = await getSubscription(tenantId);
  if (!current) return createSubscription(actorId, tenantId, plan);
  if (current.provider && current.provider !== "manual") {
    throw new ApiError(409, "BILLED_BY_PROVIDER", "This plan is billed through the payment provider. Change it with a plan override in Billing (a second administrator approves).");
  }
  if (current.plan === plan) return current;
  const defaults = PLAN_DEFAULTS[plan];
  const { data, error } = await supabaseServiceRole()
    .from("subscriptions")
    .update({
      plan,
      max_users: defaults.maxUsers,
      max_agents: defaults.maxAgents,
      max_integrations: defaults.maxIntegrations,
      max_runtime_events_per_month: defaults.maxRuntimeEventsPerMonth,
      audit_retention_days: defaults.auditRetentionDays,
    })
    .eq("id", current.id)
    .eq("tenant_id", tenantId)
    .select()
    .single();
  if (error || !data) {
    await writePlatformAudit({ actorId, tenantId, action: "platform.subscription_plan_changed", oldValue: { plan: current.plan }, newValue: { plan }, result: "failure" });
    throw new ApiError(500, "UPDATE_FAILED", "The plan could not be changed");
  }
  await writePlatformAudit({ actorId, tenantId, action: "platform.subscription_plan_changed", oldValue: { plan: current.plan }, newValue: { plan }, result: "success" });
  return toSubscription(data);
}
