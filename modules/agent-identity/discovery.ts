import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AgentIdentityType, DiscoveryInboxEntry } from "@/lib/shared/types/agent-identity";
import { listIntegrations, listIntegrationTypes, getNormalizedObjects, listSyncJobs } from "@/modules/integrations/service";
import { computeDuplicateScore, listDiscoveryDecisions } from "./duplicates";
import { classifyAgentSignal } from "./detection";
import { toAgent } from "./mappers";

const KNOWN_IDENTITY_TYPES: AgentIdentityType[] = [
  "service_account",
  "human_delegate",
  "oauth_client",
  "workload_identity",
  "api_key",
  "mcp_server",
];

function extractDisplayName(normalized: Record<string, unknown>, raw: Record<string, unknown>): string {
  const candidates = [normalized.displayName, normalized.name, raw.displayName, raw.name];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "(unnamed)";
}

function extractField(candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function normalizeIdentityType(value: unknown): AgentIdentityType {
  const asString = String(value ?? "").toLowerCase();
  const match = KNOWN_IDENTITY_TYPES.find((t) => t === asString);
  return match ?? "service_account";
}

/**
 * Fully Functional Agent Discovery — extension of IDENTITY-P0-05's
 * `buildDiscoveryInbox()`. Still reads Integration Agent's published,
 * normalized "identity" objects through its sanctioned contract
 * (`listIntegrations`/`getNormalizedObjects`/`listIntegrationTypes`/
 * `listSyncJobs` — modules/integrations/service.ts) and reconciles each one
 * against Identity's own `agents`/`agent_identities` tables; never queries
 * `integration_objects` directly (spec §55 gate). The three original
 * categories (`new` / `likely_duplicate` / `orphaned_identity`) are
 * preserved unchanged — every entry is now additionally enriched with a
 * deterministic AI-agent detection classification/confidence/evidence
 * (./detection.ts), a best-effort change signal, and its recorded
 * ignore/link decision (./duplicates.ts's `agent_duplicate_candidates`
 * reuse), instead of replacing this reconciliation model with a new one.
 */
export async function buildDiscoveryInbox(tenantId: string): Promise<DiscoveryInboxEntry[]> {
  const integrations = await listIntegrations(tenantId);
  if (integrations.length === 0) return [];

  const [integrationTypes, decisions, supabase] = await Promise.all([
    listIntegrationTypes(),
    listDiscoveryDecisions(tenantId),
    supabaseServer(),
  ]);
  const categoryById = new Map(integrationTypes.map((t) => [t.id, t.category]));

  const [{ data: linkedRows, error: linkedError }, { data: agentRows, error: agentsError }] = await Promise.all([
    supabase.from("agent_identities").select("external_reference, source_system, agent_id, identity_type, created_at"),
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
    const [objects, syncJobs] = await Promise.all([
      getNormalizedObjects(tenantId, integration.id, "identity"),
      listSyncJobs(tenantId, integration.id),
    ]);

    // Removal safety (spec §27/§28): a source object is flagged "stale"
    // (not seen in the latest completed sync) rather than silently
    // retired — derived honestly from Integration's own sync job history,
    // with no new history table required.
    const latestCompleted = syncJobs
      .filter((j) => (j.status === "succeeded" || j.status === "partial") && j.startedAt)
      .sort((a, b) => (b.startedAt as string).localeCompare(a.startedAt as string))[0];

    const category = categoryById.get(integration.integrationTypeId);

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
      const decision = decisions.get(linkKey);

      const match = existingAgents
        .map((agent) => ({ agent, ...computeDuplicateScore(agent, { agentName: displayName, sourceSystem: integration.id, sourceObjectId: obj.externalId }) }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)[0];

      const detection = classifyAgentSignal({
        sourceName: integration.name,
        sourceCategory: category,
        displayName,
        normalized: obj.normalized,
        raw: obj.raw,
      });

      entries.push({
        externalId: obj.externalId,
        integrationId: integration.id,
        integrationName: integration.name,
        sourceSystem: integration.id,
        displayName,
        identityType: normalizeIdentityType(obj.normalized.identityType ?? obj.raw.identityType),
        owner: extractField([obj.raw.owner, obj.raw.accountowner, obj.raw.ownerEmail, obj.raw.manager]),
        application: extractField([obj.raw.application, obj.raw.endpoint, obj.raw.endpointname, obj.raw.app]),
        category: match ? "likely_duplicate" : "new",
        likelyDuplicateOfAgentId: match?.agent.id,
        duplicateMatchScore: match?.score,
        duplicateMatchedKeys: match?.matchedKeys,
        classification: detection.classification,
        confidenceScore: detection.confidenceScore,
        confidenceLevel: detection.confidenceLevel,
        signals: detection.signals,
        changeType: latestCompleted && obj.importedAt < latestCompleted.startedAt! ? "STALE" : "NEW",
        candidateStatus: decision ? (decision.status === "linked" ? "linked" : "ignored") : "open",
        linkedAgentId: decision?.status === "linked" ? (decision.matchedAgentId ?? undefined) : undefined,
        lastSeenAt: obj.importedAt,
        raw: obj.raw,
      });
    }
  }

  // Orphaned identities: an existing agent_identities link whose owning
  // agent has been retired (or no longer exists) — surfaced as its own
  // category rather than silently dropped or conflated with new discoveries.
  const integrationNameById = new Map(integrations.map((i) => [i.id, i.name]));
  const agentById = new Map(existingAgents.map((a) => [a.id, a]));
  for (const link of linkedRows ?? []) {
    const owner = agentById.get(link.agent_id);
    if (!owner || owner.lifecycleState === "RETIRED") {
      entries.push({
        externalId: link.external_reference,
        integrationId: link.source_system,
        integrationName: integrationNameById.get(link.source_system) ?? link.source_system,
        sourceSystem: link.source_system,
        displayName: owner ? owner.agentName : "(retired agent)",
        identityType: normalizeIdentityType(link.identity_type),
        owner: null,
        application: null,
        category: "orphaned_identity",
        classification: "UNKNOWN",
        confidenceScore: 0,
        confidenceLevel: "LOW",
        signals: [],
        changeType: "NEW",
        candidateStatus: "open",
        lastSeenAt: link.created_at,
        raw: {},
      });
    }
  }

  return entries;
}

/**
 * Single-candidate lookup for the Candidate Review detail page — reuses
 * `buildDiscoveryInbox()` rather than a second query path, so the detail
 * page can never disagree with the inbox list it was opened from.
 */
export async function getDiscoveryCandidate(
  tenantId: string,
  integrationId: string,
  externalId: string,
): Promise<DiscoveryInboxEntry | null> {
  const entries = await buildDiscoveryInbox(tenantId);
  return entries.find((e) => e.integrationId === integrationId && e.externalId === externalId) ?? null;
}
