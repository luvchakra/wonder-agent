import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { writeAudit } from "@/lib/audit/writeAudit";
import type { AgentIdentityLink, AgentIdentityType } from "@/lib/shared/types/agent-identity";
import { toAgentIdentityLink } from "./mappers";

/**
 * IDENTITY-P0-01.2, corrected by IDENTITY-P0-14 (codebase-map D3,
 * 2026-09-25). `agent_identities` has client-facing tenant-scoped
 * INSERT/SELECT/UPDATE policies (migration 0013), so this runs as the
 * calling user.
 *
 * It used to hard-code `confidence: "confirmed"` and write no audit event.
 * Now:
 * - every caller states the confidence and the basis for it (a person who
 *   reviewed discovery evidence confirms; an API caller asserting a
 *   reference nobody checked is "unverified" unless it says otherwise);
 * - every link is audited (#11) with the actor, the confidence and the
 *   basis. The basis lives in the audit trail; the table stays as it was.
 */
export type IdentityConfidence = AgentIdentityLink["confidence"];
const CONFIDENCES: IdentityConfidence[] = ["unverified", "probable", "confirmed"];

export async function linkAgentIdentity(
  tenantId: string,
  agentId: string,
  identityType: AgentIdentityType,
  externalReference: string,
  sourceSystem: string,
  provenance: { actorId: string | null; confidence: IdentityConfidence; basis: string },
): Promise<AgentIdentityLink> {
  if (!CONFIDENCES.includes(provenance.confidence)) {
    throw new ApiError(400, "VALIDATION_FAILED", `confidence: one of ${CONFIDENCES.join(", ")}`);
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_identities")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      identity_type: identityType,
      external_reference: externalReference,
      source_system: sourceSystem,
      confidence: provenance.confidence,
    })
    .select()
    .single();
  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to link identity");
  }
  await writeAudit({
    tenantId,
    actorId: provenance.actorId,
    actorType: provenance.actorId ? "user" : "system",
    action: "agent.identity_linked",
    objectType: "agent_identity",
    objectId: data.id,
    outcome: "success",
    metadata: { agentId, identityType, sourceSystem, externalReference, confidence: provenance.confidence, basis: provenance.basis.slice(0, 500) },
  });
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
