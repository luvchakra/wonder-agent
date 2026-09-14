import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { getSubscription } from "./subscriptions";

export type UsageResource = "users" | "agents" | "integrations" | "runtime_events_per_month";

export type UsageCheck = {
  resource: UsageResource;
  current: number;
  limit: number | null;
  status: "ok" | "soft_warning" | "hard_block" | "unlimited";
};

/**
 * PLATFORM-P0-05.1 — soft warning at 90% of the subscription's limit, hard
 * block at or above 100%. A business decision, not an architecture one
 * (same framing PLATFORM-P0-02.1's own `PLAN_DEFAULTS` used) — documented
 * here, and in the audit log, so the user can adjust it without
 * re-deriving the schema.
 */
const SOFT_WARNING_THRESHOLD = 0.9;

/** Pure — the band a usage/limit ratio falls into, at the documented thresholds above. */
export function classifyUsage(current: number, limit: number): "ok" | "soft_warning" | "hard_block" {
  const ratio = limit > 0 ? current / limit : Number.POSITIVE_INFINITY;
  if (ratio >= 1) return "hard_block";
  if (ratio >= SOFT_WARNING_THRESHOLD) return "soft_warning";
  return "ok";
}

const LIMIT_COLUMN: Record<UsageResource, "maxUsers" | "maxAgents" | "maxIntegrations" | "maxRuntimeEventsPerMonth"> = {
  users: "maxUsers",
  agents: "maxAgents",
  integrations: "maxIntegrations",
  runtime_events_per_month: "maxRuntimeEventsPerMonth",
};

/**
 * Every branch is scoped to the one `tenantId` passed in — no cross-tenant
 * aggregation anywhere in this module, per CLAUDE.md §14. Storage and
 * AI-consumption usage are not measured here — no module in this build
 * tracks either yet (flagged, not silently assumed, same treatment Risk
 * Agent gave its own unmeasured severity factors).
 */
async function getCurrentUsage(tenantId: string, resource: UsageResource): Promise<number> {
  const supabase = supabaseServiceRole();
  switch (resource) {
    case "users": {
      const { count, error } = await supabase
        .from("tenant_memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "active");
      if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
      return count ?? 0;
    }
    case "agents": {
      const { count, error } = await supabase.from("agents").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
      if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
      return count ?? 0;
    }
    case "integrations": {
      const { count, error } = await supabase.from("integrations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
      if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
      return count ?? 0;
    }
    case "runtime_events_per_month": {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from("runtime_events")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("event_time", monthStart.toISOString());
      if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
      return count ?? 0;
    }
  }
}

/**
 * PLATFORM-P0-05.1's published contract — mirrors the `isFeatureEnabled()`
 * pattern: other modules' write paths are expected to call this before a
 * consequential create. Not yet wired into any other module's create path
 * this session (same as `isFeatureEnabled()` itself, which no module calls
 * yet either) — publishing the contract is this story's job; wiring each
 * module's own create path is that module's, per non-negotiable #18.
 */
export async function checkUsageLimit(tenantId: string, resource: UsageResource): Promise<UsageCheck> {
  const subscription = await getSubscription(tenantId);
  const current = await getCurrentUsage(tenantId, resource);
  if (!subscription) {
    return { resource, current, limit: null, status: "unlimited" };
  }
  const limit = subscription[LIMIT_COLUMN[resource]];
  return { resource, current, limit, status: classifyUsage(current, limit) };
}

/** Platform-admin UI surface: every resource's usage vs. limit for one tenant, in one call. */
export async function getUsageSummary(tenantId: string): Promise<UsageCheck[]> {
  const resources: UsageResource[] = ["users", "agents", "integrations", "runtime_events_per_month"];
  return Promise.all(resources.map((r) => checkUsageLimit(tenantId, r)));
}
