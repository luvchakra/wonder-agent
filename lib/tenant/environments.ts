import "server-only";

import { cache } from "react";
import { supabaseServer } from "@/lib/db/supabaseServer";

/**
 * Owner request (2026-10-13): the environment of each of the signed-in
 * person's organizations, for its designated colour, and the production
 * organization it belongs to, for one-click environment switching. Read as
 * the person (my_organization_environments(), migration 0159: their own
 * active memberships only). Unreadable means "not shown", never a guess.
 */
export const getMyTenantEnvironments = cache(async (): Promise<Map<string, { environment: string; parentTenantId: string | null }>> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("my_organization_environments");
  if (error || !Array.isArray(data)) return new Map();
  return new Map((data as { tenant_id: string; environment: string; parent_tenant_id: string | null }[]).map((r) => [r.tenant_id, { environment: r.environment, parentTenantId: r.parent_tenant_id }]));
});
