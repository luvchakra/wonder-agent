import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AgentIdentityType, DiscoveryInboxEntry, NhiInventoryEntry } from "@/lib/shared/types/agent-identity";
import { listIntegrations } from "@/modules/integrations/service";
import { buildDiscoveryInbox } from "./discovery";
import { RUNTIME_SOURCE, RUNTIME_SOURCE_NAME } from "./shadowAi";

/**
 * IDENTITY-P0-11 (master P0-08) — the non-human identity inventory.
 *
 * Not a parallel registry: it is a read over what Identity already owns.
 * - Linked NHIs are `agent_identities` rows, with their agent.
 * - Unlinked NHIs are Integration's normalized identity objects that
 *   discovery has not correlated to any agent (`buildDiscoveryInbox()`),
 *   with discovery's deterministic classification. An unlinked NHI is
 *   listed whether or not it looks like an AI agent: most service accounts
 *   are not agents, and the inventory must not imply they are.
 * - Linking an NHI to an agent goes through the existing discovery
 *   decision flow (each unlinked row links to its candidate page).
 *
 * Human delegate identities are excluded: they are people's accounts an
 * agent acts through, not non-human identities.
 *
 * Reads run as the calling user under RLS, with an explicit tenant filter
 * as defence in depth (CLAUDE.md §14).
 */

const NON_HUMAN = (t: AgentIdentityType) => t !== "human_delegate";

type LinkedRow = {
  external_reference: string;
  source_system: string;
  identity_type: AgentIdentityType;
  status: string;
  created_at: string;
  agent_id: string;
  agents: { id: string; agent_name: string; lifecycle_state: string } | null;
};

export function inventoryFromSources(
  linked: LinkedRow[],
  inbox: DiscoveryInboxEntry[],
  sourceNames: Map<string, string>,
): NhiInventoryEntry[] {
  const entries: NhiInventoryEntry[] = [];
  const seen = new Set<string>();

  for (const row of linked) {
    if (row.status === "removed" || !NON_HUMAN(row.identity_type)) continue;
    const key = `${row.source_system}::${row.external_reference}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const agent = row.agents;
    const orphaned = !agent || agent.lifecycle_state === "RETIRED";
    entries.push({
      key,
      externalReference: row.external_reference,
      displayName: row.external_reference,
      identityType: row.identity_type,
      sourceSystem: row.source_system,
      sourceName: sourceNames.get(row.source_system) ?? row.source_system,
      status: orphaned ? "orphaned" : "linked",
      agent: agent ? { id: agent.id, name: agent.agent_name, lifecycleState: agent.lifecycle_state } : null,
      classification: null,
      confidenceLevel: null,
      owner: null,
      lastSeenAt: row.created_at,
      href: agent ? `/agents/${agent.id}` : `/agents/discovery`,
    });
  }

  for (const e of inbox) {
    // Orphaned links are already listed above, from the link itself.
    if (e.category === "orphaned_identity" || !NON_HUMAN(e.identityType)) continue;
    const key = `${e.sourceSystem}::${e.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      key,
      externalReference: e.externalId,
      displayName: e.displayName,
      identityType: e.identityType,
      sourceSystem: e.sourceSystem,
      sourceName: e.integrationName,
      status: e.candidateStatus === "ignored" ? "ignored" : "unlinked",
      agent: null,
      classification: e.classification,
      confidenceLevel: e.confidenceLevel,
      owner: e.owner,
      lastSeenAt: e.lastSeenAt,
      href: `/agents/discovery/${encodeURIComponent(e.integrationId)}/${encodeURIComponent(e.externalId)}`,
    });
  }

  return entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function buildNhiInventory(tenantId: string): Promise<NhiInventoryEntry[]> {
  const supabase = await supabaseServer();
  const [linkedRes, inbox, integrations] = await Promise.all([
    supabase
      .from("agent_identities")
      .select("external_reference, source_system, identity_type, status, created_at, agent_id, agents(id, agent_name, lifecycle_state)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(2000),
    buildDiscoveryInbox(tenantId),
    listIntegrations(tenantId),
  ]);
  if (linkedRes.error) throw new ApiError(500, "QUERY_FAILED", linkedRes.error.message);
  const sourceNames = new Map([[RUNTIME_SOURCE, RUNTIME_SOURCE_NAME], ...integrations.map((i) => [i.id, i.name] as [string, string])]);
  return inventoryFromSources((linkedRes.data ?? []) as unknown as LinkedRow[], inbox, sourceNames);
}
