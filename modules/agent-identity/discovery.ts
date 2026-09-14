import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { DiscoveryInboxEntry } from "@/lib/shared/types/agent-identity";
import { listIntegrations, getNormalizedObjects } from "@/modules/integrations/service";
import { computeDuplicateScore } from "./duplicates";
import { toAgent } from "./mappers";

function extractDisplayName(normalized: Record<string, unknown>, raw: Record<string, unknown>): string {
  const candidates = [normalized.displayName, normalized.name, raw.displayName, raw.name];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "(unnamed)";
}

/**
 * IDENTITY-P0-05 — Discovery Reconciliation & Orphaned Identity Detection.
 *
 * Reads Integration Agent's published, normalized "identity" objects
 * through its sanctioned contract (modules/integrations/service.ts —
 * `listIntegrations`/`getNormalizedObjects`) and reconciles each one
 * against Identity's own `agents`/`agent_identities` tables. Never invents
 * Integration's data shape or reads its tables directly (CLAUDE.md
 * non-negotiable #6). If the tenant has no configured integrations yet,
 * this correctly returns an empty list rather than fake/stubbed rows —
 * same rule IDENTITY-P0-01.3 already followed while Integration Agent's
 * contract didn't exist; it exists now, so this both implements
 * IDENTITY-P0-05 and resolves 01.3's dependency in the same pass.
 */
export async function buildDiscoveryInbox(tenantId: string): Promise<DiscoveryInboxEntry[]> {
  const integrations = await listIntegrations(tenantId);
  if (integrations.length === 0) return [];

  const supabase = await supabaseServer();
  const [{ data: linkedRows, error: linkedError }, { data: agentRows, error: agentsError }] = await Promise.all([
    supabase.from("agent_identities").select("external_reference, source_system, agent_id"),
    supabase.from("agents").select(),
  ]);
  if (linkedError) throw new ApiError(500, "QUERY_FAILED", linkedError.message);
  if (agentsError) throw new ApiError(500, "QUERY_FAILED", agentsError.message);

  const existingAgents = (agentRows ?? []).map(toAgent);
  const linkedExternalRefs = new Set(
    (linkedRows ?? []).map((r) => `${r.source_system}::${r.external_reference}`),
  );

  const entries: DiscoveryInboxEntry[] = [];

  for (const integration of integrations) {
    const objects = await getNormalizedObjects(tenantId, integration.id, "identity");
    for (const obj of objects) {
      // `agent_identities.source_system` is treated as the integration's id
      // for anything correlated from Integration Agent's data (as opposed
      // to a human-entered string like "manual" for hand-linked identities)
      // — see linkAgentIdentity()'s own free-text sourceSystem parameter.
      const linkKey = `${integration.id}::${obj.externalId}`;
      // Already correlated to a live agent — fully resolved, not an inbox item.
      if (linkedExternalRefs.has(linkKey)) {
        continue;
      }

      const displayName = extractDisplayName(obj.normalized, obj.raw);
      const match = existingAgents
        .map((agent) => ({ agent, ...computeDuplicateScore(agent, { agentName: displayName, sourceSystem: integration.id, sourceObjectId: obj.externalId }) }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)[0];

      entries.push({
        externalId: obj.externalId,
        integrationId: integration.id,
        sourceSystem: integration.id,
        displayName,
        category: match ? "likely_duplicate" : "new",
        likelyDuplicateOfAgentId: match?.agent.id,
        raw: obj.raw,
      });
    }
  }

  // Orphaned identities: an existing agent_identities link whose owning
  // agent has been retired (or no longer exists) — surfaced as its own
  // category rather than silently dropped or conflated with new discoveries.
  const agentById = new Map(existingAgents.map((a) => [a.id, a]));
  for (const link of linkedRows ?? []) {
    const owner = agentById.get(link.agent_id);
    if (!owner || owner.lifecycleState === "RETIRED") {
      entries.push({
        externalId: link.external_reference,
        integrationId: link.source_system,
        sourceSystem: link.source_system,
        displayName: owner ? owner.agentName : "(retired agent)",
        category: "orphaned_identity",
        raw: {},
      });
    }
  }

  return entries;
}
