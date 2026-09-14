import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { Agent, DuplicateCandidate } from "@/lib/shared/types/agent-identity";
import { toAgent, toDuplicateCandidate } from "./mappers";
import type { CreateAgentInput } from "./agents";

/** Score at/above this is treated as a likely duplicate. */
export const DUPLICATE_MATCH_THRESHOLD = 0.6;

/**
 * IDENTITY-P0-04 — deterministic (no LLM, per CLAUDE.md non-negotiable #9)
 * duplicate-candidate scoring using admin-relevant identity keys. A
 * `source_system` + `source_object_id` match is treated as decisive (the
 * same external system reporting the same object id twice); an
 * `agent_name` match alone is weaker evidence, since two distinct agents
 * can legitimately share a display name. Pure function — no I/O — so it's
 * unit-testable without a database.
 */
export function computeDuplicateScore(
  existing: Pick<Agent, "agentName" | "sourceSystem" | "sourceObjectId">,
  candidate: Pick<CreateAgentInput, "agentName" | "sourceSystem" | "sourceObjectId">,
): { score: number; matchedKeys: string[] } {
  const matchedKeys: string[] = [];

  const sameSourceObject =
    !!existing.sourceObjectId &&
    !!candidate.sourceObjectId &&
    existing.sourceSystem === candidate.sourceSystem &&
    existing.sourceObjectId === candidate.sourceObjectId;
  if (sameSourceObject) {
    matchedKeys.push("source_system", "source_object_id");
    return { score: 1, matchedKeys };
  }

  const sameName =
    existing.agentName.trim().toLowerCase() === candidate.agentName.trim().toLowerCase();
  if (sameName) {
    matchedKeys.push("agent_name");
    return { score: 0.6, matchedKeys };
  }

  return { score: 0, matchedKeys: [] };
}

/**
 * Scans every existing agent in the tenant for the best duplicate match
 * against a pending registration. O(n) over the tenant's agent count — fine
 * at P0 scale; a future revision can push this into a database query if a
 * tenant's agent count ever makes the client-side scan a real cost.
 */
export async function findDuplicateCandidate(
  tenantId: string,
  input: Pick<CreateAgentInput, "agentName" | "sourceSystem" | "sourceObjectId">,
): Promise<{ agent: Agent; score: number; matchedKeys: string[] } | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("agents").select();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  let best: { agent: Agent; score: number; matchedKeys: string[] } | null = null;

  for (const row of data ?? []) {
    const agent = toAgent(row);
    const { score, matchedKeys } = computeDuplicateScore(agent, input);
    if (score >= DUPLICATE_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { agent, score, matchedKeys };
    }
  }
  return best;
}

/**
 * Records a pending registration as a duplicate candidate instead of
 * creating the `agents` row. Evidentiary data — service-role write, like
 * `risk_findings`/`certification_decisions` (CLAUDE.md §14: RLS is
 * select-only for authenticated, the mutation path is this function).
 */
export async function createDuplicateCandidate(
  tenantId: string,
  actorId: string,
  matchedAgentId: string,
  candidateData: CreateAgentInput,
  score: number,
  matchedKeys: string[],
): Promise<DuplicateCandidate> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("agent_duplicate_candidates")
    .insert({
      tenant_id: tenantId,
      matched_agent_id: matchedAgentId,
      candidate_data: candidateData,
      match_score: score,
      matched_keys: matchedKeys,
      created_by: actorId,
    })
    .select()
    .single();
  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to record duplicate candidate");
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent.duplicate_candidate_created",
    objectType: "agent_duplicate_candidate",
    objectId: data.id,
    outcome: "success",
    metadata: { matchedAgentId, score, matchedKeys },
  });

  return toDuplicateCandidate(data);
}

export async function listDuplicateCandidates(
  tenantId: string,
  status?: DuplicateCandidate["status"],
): Promise<DuplicateCandidate[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("agent_duplicate_candidates").select().order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toDuplicateCandidate);
}

async function loadOwnCandidate(tenantId: string, candidateId: string) {
  const supabase = supabaseServiceRole();
  const { data } = await supabase
    .from("agent_duplicate_candidates")
    .select()
    .eq("id", candidateId)
    .maybeSingle();
  if (!data || data.tenant_id !== tenantId) {
    throw new ApiError(404, "NOT_FOUND", "Duplicate candidate not found");
  }
  if (data.status !== "pending") {
    throw new ApiError(409, "ALREADY_RESOLVED", "Duplicate candidate already reviewed");
  }
  return data;
}

/**
 * Reviewer confirms the two records really are the same real-world agent.
 * "Merge" here means: the pending registration attempt is voided — since it
 * was never inserted into `agents` in the first place (createAgent() diverts
 * to createDuplicateCandidate() instead of inserting), voiding it is just
 * marking the candidate `merged`; the existing survivor's own lifecycle/
 * audit history is untouched by construction, not by an explicit merge
 * operation on two real rows.
 */
export async function mergeDuplicateCandidate(
  tenantId: string,
  actorId: string,
  candidateId: string,
): Promise<void> {
  const candidate = await loadOwnCandidate(tenantId, candidateId);
  const supabase = supabaseServiceRole();
  const { error } = await supabase
    .from("agent_duplicate_candidates")
    .update({ status: "merged", reviewed_by: actorId, reviewed_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent.duplicate_candidate_merged",
    objectType: "agent_duplicate_candidate",
    objectId: candidateId,
    outcome: "success",
    metadata: { matchedAgentId: candidate.matched_agent_id },
  });
}

/**
 * Reviewer confirms the two records are genuinely distinct agents —
 * completes the originally-deferred registration now.
 */
export async function confirmDistinctAndRegister(
  tenantId: string,
  actorId: string,
  candidateId: string,
): Promise<Agent> {
  const candidate = await loadOwnCandidate(tenantId, candidateId);
  const { createAgentRow } = await import("./agents");
  const agent = await createAgentRow(tenantId, actorId, candidate.candidate_data as CreateAgentInput);

  const supabase = supabaseServiceRole();
  const { error } = await supabase
    .from("agent_duplicate_candidates")
    .update({ status: "confirmed_distinct", reviewed_by: actorId, reviewed_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent.duplicate_candidate_confirmed_distinct",
    objectType: "agent_duplicate_candidate",
    objectId: candidateId,
    outcome: "success",
    metadata: { newAgentId: agent.id },
  });

  return agent;
}
