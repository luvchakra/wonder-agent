import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type {
  Agent,
  AgentCriticality,
  AgentEnvironment,
  AgentFilter,
  CreateAgentResult,
} from "@/lib/shared/types/agent-identity";
import { toAgent } from "./mappers";
import { maybeMarkCertificationDue } from "./lifecycle";

export type CreateAgentInput = {
  agentName: string;
  agentType: string;
  displayName?: string;
  description?: string;
  purpose?: string;
  agentFramework?: string;
  modelProvider?: string;
  modelName?: string;
  modelVersion?: string;
  runtime?: string;
  environment?: AgentEnvironment;
  criticality?: AgentCriticality;
  dataClassification?: string;
  sourceSystem?: string;
  sourceObjectId?: string;
};

/**
 * IDENTITY-P0-04 — runs the duplicate-candidate check before ever inserting
 * a new `agents` row. If an existing agent scores at/above the match
 * threshold, the registration is diverted into a reviewable duplicate
 * candidate instead of silently creating a second record for the same
 * real-world agent; the caller (API route / server action) must present
 * that outcome to the user rather than assuming a new agent was created.
 */
export async function createAgent(
  tenantId: string,
  actorId: string,
  input: CreateAgentInput,
): Promise<CreateAgentResult> {
  if (!input.agentName.trim()) throw new ApiError(400, "INVALID_INPUT", "agentName is required");
  if (!input.agentType.trim()) throw new ApiError(400, "INVALID_INPUT", "agentType is required");

  const { findDuplicateCandidate, createDuplicateCandidate } = await import("./duplicates");
  const match = await findDuplicateCandidate(tenantId, input);
  if (match) {
    const candidate = await createDuplicateCandidate(
      tenantId,
      actorId,
      match.agent.id,
      input,
      match.score,
      match.matchedKeys,
    );
    return { kind: "duplicate_candidate", candidate };
  }

  const agent = await createAgentRow(tenantId, actorId, input);
  return { kind: "created", agent };
}

/**
 * The actual `agents` insert, extracted so both the normal registration
 * path above and `confirmDistinctAndRegister()` (a reviewer overriding a
 * duplicate-candidate finding) share one insert implementation. Runs as the
 * calling user via supabaseServer() — RLS's `with check (tenant_id in
 * (select current_tenant_ids()))` on `agents` (see
 * supabase/migrations/0012_identity_agents.sql) is the tenant-isolation
 * backstop; `agent.create` permission is enforced by the caller via
 * requirePermission() before this is invoked.
 */
export async function createAgentRow(
  tenantId: string,
  actorId: string,
  input: CreateAgentInput,
): Promise<Agent> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agents")
    .insert({
      tenant_id: tenantId,
      agent_name: input.agentName,
      agent_type: input.agentType,
      display_name: input.displayName ?? null,
      description: input.description ?? null,
      purpose: input.purpose ?? null,
      agent_framework: input.agentFramework ?? null,
      model_provider: input.modelProvider ?? null,
      model_name: input.modelName ?? null,
      model_version: input.modelVersion ?? null,
      runtime: input.runtime ?? null,
      environment: input.environment ?? "production",
      criticality: input.criticality ?? "medium",
      data_classification: input.dataClassification ?? null,
      source_system: input.sourceSystem ?? "manual",
      source_object_id: input.sourceObjectId ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create agent");
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent.registered",
    objectType: "agent",
    objectId: data.id,
    outcome: "success",
    metadata: { agentName: input.agentName, agentType: input.agentType },
  });

  return toAgent(data);
}

/**
 * Fetches a single agent scoped to the caller's tenant via RLS. Lazily
 * resolves the ACTIVE -> CERTIFICATION_DUE transition on read per
 * IDENTITY-P0-02.1's note that this "can be computed on read rather than
 * requiring a background cron."
 */
export async function getAgent(tenantId: string, agentId: string): Promise<Agent | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agents")
    .select()
    .eq("id", agentId)
    .maybeSingle();

  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;

  const agent = toAgent(data);
  return maybeMarkCertificationDue(tenantId, agent);
}

/**
 * Lists agents in the caller's tenant. `filter.status ===
 * "discovered_unregistered"` was IDENTITY-P0-01.3's original discovery-inbox
 * filter, kept returning an empty `Agent[]` here for backward compatibility
 * with any existing caller of this exact shape — but the real, reconciled
 * discovery inbox (three categories: new/likely-duplicate/orphaned, a
 * different shape than `Agent[]`) is now `buildDiscoveryInbox()`
 * (IDENTITY-P0-05, ./discovery.ts), reading through Integration Agent's now-
 * published `getNormalizedObjects()` contract. See the Identity Agent audit
 * log's 2026-09-14 entry.
 */
export async function listAgents(tenantId: string, filter?: AgentFilter): Promise<Agent[]> {
  if (filter?.status === "discovered_unregistered") {
    return [];
  }

  const supabase = await supabaseServer();
  let query = supabase.from("agents").select().order("created_at", { ascending: false });
  if (filter?.lifecycleState) {
    query = query.eq("lifecycle_state", filter.lifecycleState);
  }

  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  const agents = (data ?? []).map(toAgent);
  return Promise.all(agents.map((a) => maybeMarkCertificationDue(tenantId, a)));
}
