import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { SubscriptionPlan } from "@/lib/shared/types/platform";
import { changePlan, createSubscription, getSubscription } from "./subscriptions";

/**
 * Owner decision (2026-10-13): an organization has one plan, the same in
 * every environment. Each environment is its own tenant with its own
 * subscription row (limits apply per environment), so the plan is set on
 * the organization and copied to each environment; a new environment
 * inherits it. A plan billed through a payment provider is not overwritten
 * here (changePlan refuses it), and the refusal is reported.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The organization and its current (not removed) environments. */
export async function organizationTenantIds(organizationId: string): Promise<string[]> {
  const supabase = supabaseServiceRole();
  const { data: children, error } = await supabase.from("platform_tenants").select("tenant_id").eq("parent_tenant_id", organizationId);
  if (error) throw new ApiError(500, "QUERY_FAILED", "The organization's environments could not be read");
  const ids = (children ?? []).map((c) => c.tenant_id as string);
  if (!ids.length) return [organizationId];
  const { data: live, error: liveError } = await supabase.from("tenants").select("id").in("id", ids).neq("status", "deprovisioned");
  if (liveError) throw new ApiError(500, "QUERY_FAILED", "The organization's environments could not be read");
  return [organizationId, ...(live ?? []).map((t) => t.id as string)];
}

export async function setOrganizationPlan(actorId: string, organizationId: string, plan: SubscriptionPlan): Promise<{ changed: number }> {
  if (!UUID.test(organizationId)) throw new ApiError(404, "TENANT_NOT_FOUND");
  const { data: link } = await supabaseServiceRole().from("platform_tenants").select("parent_tenant_id").eq("tenant_id", organizationId).maybeSingle();
  if (link?.parent_tenant_id) throw new ApiError(400, "INVALID_INPUT", "The plan is set on the organization, for all its environments");
  const ids = await organizationTenantIds(organizationId);
  const refused: string[] = [];
  for (const id of ids) {
    try {
      await changePlan(actorId, id, plan);
    } catch (err) {
      if (err instanceof ApiError && err.code === "BILLED_BY_PROVIDER") refused.push(id);
      else throw err;
    }
  }
  if (refused.length)
    throw new ApiError(409, "BILLED_BY_PROVIDER", `${ids.length - refused.length} of ${ids.length} environments changed; the rest are billed through the payment provider. Change those in Billing.`);
  return { changed: ids.length };
}

/** A new environment takes its organization's plan. Returns the plan copied, or null when the organization has none. */
export async function inheritOrganizationPlan(actorId: string, organizationId: string, environmentTenantId: string): Promise<SubscriptionPlan | null> {
  const [orgSub, envSub] = await Promise.all([getSubscription(organizationId), getSubscription(environmentTenantId)]);
  if (!orgSub || envSub) return envSub?.plan ?? null;
  await createSubscription(actorId, environmentTenantId, orgSub.plan);
  return orgSub.plan;
}
