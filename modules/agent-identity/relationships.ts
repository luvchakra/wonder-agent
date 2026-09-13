import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AgentRelationship, AgentRelationshipType } from "@/lib/shared/types/agent-identity";
import { toAgentRelationship } from "./mappers";

/**
 * IDENTITY-P0-02.3. `agent_relationships` has client-facing tenant-scoped
 * INSERT/SELECT/DELETE policies (migration 0017) — runs as the calling user.
 */
export async function addRelationship(
  tenantId: string,
  agentId: string,
  relatedAgentId: string,
  relationshipType: AgentRelationshipType,
): Promise<AgentRelationship> {
  if (agentId === relatedAgentId) {
    throw new ApiError(400, "INVALID_INPUT", "An agent cannot relate to itself");
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_relationships")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      related_agent_id: relatedAgentId,
      relationship_type: relationshipType,
    })
    .select()
    .single();
  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to add relationship");
  }
  return toAgentRelationship(data);
}

export async function listRelationships(
  tenantId: string,
  agentId: string,
): Promise<AgentRelationship[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_relationships")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAgentRelationship);
}

export async function removeRelationship(tenantId: string, relationshipId: string): Promise<void> {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("agent_relationships")
    .delete()
    .eq("id", relationshipId)
    .eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "DELETE_FAILED", error.message);
}
