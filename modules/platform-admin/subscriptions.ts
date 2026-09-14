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
 */
export const PLAN_DEFAULTS: Record<SubscriptionPlan, Omit<Subscription, "id" | "tenantId" | "status" | "startedAt" | "renewedAt" | "plan">> = {
  free: { maxUsers: 3, maxAgents: 5, maxIntegrations: 1, maxRuntimeEventsPerMonth: 10_000, auditRetentionDays: 30 },
  pro: { maxUsers: 25, maxAgents: 50, maxIntegrations: 5, maxRuntimeEventsPerMonth: 250_000, auditRetentionDays: 90 },
  max: { maxUsers: 100, maxAgents: 250, maxIntegrations: 20, maxRuntimeEventsPerMonth: 2_000_000, auditRetentionDays: 365 },
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
