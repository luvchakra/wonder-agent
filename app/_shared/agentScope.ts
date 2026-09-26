import "server-only";

import { getAgent } from "@/modules/agent-identity/service";
import type { ResourceRef } from "@/lib/rbac/authorize";

/**
 * FOUNDATION-P0-19 — an agent as an authorization resource: its id and
 * environment, read in the caller's tenant through the Identity module's
 * published service. Null when there is no such agent there (the check
 * then counts tenant-wide grants only, and the route answers 404).
 */
export function agentResource(agentId: string) {
  return async (tenantId: string): Promise<ResourceRef | null> => {
    const agent = await getAgent(tenantId, agentId).catch(() => null);
    return agent ? { type: "agent", id: agent.id, environment: agent.environment } : null;
  };
}
