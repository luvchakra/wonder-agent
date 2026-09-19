import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AgentIdentityLink, AgentIdentityType } from "@/lib/shared/types/agent-identity";
import { toAgentIdentityLink } from "./mappers";

/**
 * IDENTITY-P0-01.2. `agent_identities` has client-facing tenant-scoped
 * INSERT/SELECT/UPDATE policies (migration 0013) — runs as the calling user.
 * P0 scope is manual linking only; no fuzzy-matching correlation engine.
 */
export async function linkAgentIdentity(
  tenantId: string,
  agentId: string,
  identityType: AgentIdentityType,
  externalReference: string,
  sourceSystem: string,
): Promise<AgentIdentityLink> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_identities")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      identity_type: identityType,
      external_reference: externalReference,
      source_system: sourceSystem,
      confidence: "confirmed",
    })
    .select()
    .single();
  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to link identity");
  }
  return toAgentIdentityLink(data);
}

export async function listAgentIdentities(
  tenantId: string,
  agentId: string,
): Promise<AgentIdentityLink[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_identities")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAgentIdentityLink);
}

/**
 * OPERATIONS-P0-03.1's "identity" search object type — the tenant-wide
 * counterpart to `listAgentIdentities()` above, same reasoning as
 * `listOwnersForTenant()` (modules/agent-identity/owners.ts): the embed
 * is a real FK (`agent_identities.agent_id -> agents(id)`), read here
 * rather than making Operations query `agents` itself.
 */
export type IdentityWithContext = AgentIdentityLink & { agentName: string };

export async function listIdentitiesForTenant(tenantId: string): Promise<IdentityWithContext[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_identities")
    .select("*, agents(agent_name)")
    .eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((row: Record<string, unknown> & { agents: { agent_name: string } | null }) => ({
    ...toAgentIdentityLink(row),
    agentName: row.agents?.agent_name ?? "",
  }));
}
