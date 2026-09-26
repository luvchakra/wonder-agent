import "server-only";

import { listApplications } from "@/modules/access-governance/service";
import { listAgents } from "@/modules/agent-identity/service";
import type { ScopeOption } from "./AssignmentTermsFields";

/**
 * FOUNDATION-P0-19 — the applications and agents a role assignment or an
 * authorization policy can be scoped to, from the owning modules'
 * published services (this tenant's, through RLS).
 */
export async function loadScopeOptions(tenantId: string): Promise<{ applications: ScopeOption[]; agents: ScopeOption[] }> {
  const [applications, agents] = await Promise.all([listApplications(tenantId), listAgents(tenantId)]);
  return {
    applications: applications.map((a) => ({ id: a.id, label: a.name })).sort((a, b) => a.label.localeCompare(b.label)),
    agents: agents.map((a) => ({ id: a.id, label: a.displayName || a.agentName })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}
