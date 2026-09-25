import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { runAfterResponse } from "@/lib/shared/afterResponse";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RuntimeDecision, RuntimeRequest } from "@/lib/shared/types/access-governance";
import type { GatewayDecision, GatewayDecisionRecord, GatewayMode, RuntimeEventType } from "@/lib/shared/types/runtime";
import { evaluateRuntimeRequest, evaluateToolVisibility, type RuntimePrincipal, type ToolVisibility } from "@/modules/access-governance/service";
import { loadActiveEmergencyState } from "./emergency";
import { getFeatureFlags } from "@/modules/platform-admin/service";

/**
 * RUNTIME-P0-15 — the Runtime Gateway (master stories P0-26/P0-27/P0-33).
 *
 * The flow for one request: agent API key (verified by the route) →
 * validated request → idempotency check → Access's deterministic
 * `evaluateRuntimeRequest()` → an immutable `runtime_decisions` record →
 * audit → the answer.
 *
 * - **Tenant and agent come only from the verified key.** Any
 *   `tenantId`/`agentId` in the body is ignored, never trusted (#2).
 * - **OBSERVE_ONLY is the default mode** (user decision, 2026-09-25). The
 *   decision is computed and recorded exactly as enforcement would make
 *   it, but the caller is told to proceed. ENFORCE is switched on per
 *   tenant later through a feature flag (PLATFORM-P0-12); until then no
 *   tenant is in ENFORCE.
 * - **No dashboard work and no model in this path** (master §25, #9).
 *   The path is three database round trips: key verification; then the
 *   idempotency lookup and every decision fact in parallel; then the
 *   decision insert. The audit row follows after the response.
 */

const MAX_FIELD = 200;

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ApiError(400, "VALIDATION_FAILED", `${field}: must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_FIELD) throw new ApiError(400, "VALIDATION_FAILED", `${field}: must be at most ${MAX_FIELD} characters`);
  return trimmed || undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates an authorization request body. It keeps only the known fields,
 * so a smuggled `tenantId` or `agentId` is simply dropped.
 */
export function parseGatewayRequest(raw: unknown): RuntimeRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ApiError(400, "VALIDATION_FAILED", "body: must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  const requestId = optionalString(body, "requestId");
  const action = optionalString(body, "action");
  if (!requestId) throw new ApiError(400, "VALIDATION_FAILED", "requestId: required");
  if (!action) throw new ApiError(400, "VALIDATION_FAILED", "action: required");

  const identityId = optionalString(body, "identityId");
  if (identityId && !UUID_RE.test(identityId)) throw new ApiError(400, "VALIDATION_FAILED", "identityId: must be a UUID");

  const ctxRaw = body.context;
  if (ctxRaw !== undefined && (typeof ctxRaw !== "object" || ctxRaw === null || Array.isArray(ctxRaw))) {
    throw new ApiError(400, "VALIDATION_FAILED", "context: must be an object");
  }
  const ctx = (ctxRaw ?? {}) as Record<string, unknown>;
  const intentRaw = body.intent;
  if (intentRaw !== undefined && (typeof intentRaw !== "object" || intentRaw === null || Array.isArray(intentRaw))) {
    throw new ApiError(400, "VALIDATION_FAILED", "intent: must be an object");
  }
  const intent = (intentRaw ?? {}) as Record<string, unknown>;

  return {
    requestId,
    action,
    correlationId: optionalString(body, "correlationId"),
    application: optionalString(body, "application"),
    resource: optionalString(body, "resource"),
    tool: optionalString(body, "tool"),
    mcpServer: optionalString(body, "mcpServer"),
    dataClassification: optionalString(body, "dataClassification"),
    identityId,
    intent: { requestPurpose: optionalString(intent, "requestPurpose") },
    context: {
      environment: optionalString(ctx, "environment"),
      sessionId: optionalString(ctx, "sessionId"),
      userId: optionalString(ctx, "userId"),
      source: optionalString(ctx, "source"),
      timestamp: optionalString(ctx, "timestamp"),
    },
  };
}

/**
 * The tenant's gateway state, from its feature flags (PLATFORM-P0-12, user
 * decision 2026-09-25): `runtime_observe` lets agents use the gateway at
 * all (on by default), and `runtime_enforce` switches the tenant from
 * OBSERVE_ONLY to ENFORCE (off by default, turned on per tenant by a
 * platform administrator after validation). A flag read that fails throws,
 * and the request errors rather than being allowed.
 */
export async function getGatewayMode(tenantId: string): Promise<{ enabled: boolean; mode: GatewayMode; toolFiltering: boolean }> {
  const flags = await getFeatureFlags(tenantId, ["runtime_observe", "runtime_enforce", "tool_filtering"]);
  return {
    enabled: flags.runtime_observe,
    mode: flags.runtime_observe && flags.runtime_enforce ? "ENFORCE" : "OBSERVE_ONLY",
    toolFiltering: flags.tool_filtering,
  };
}

type DecisionRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  request_id: string;
  correlation_id: string;
  identity_id: string | null;
  action: string;
  application: string | null;
  resource: string | null;
  tool: string | null;
  decision: GatewayDecision["decision"];
  code: string;
  reason: string;
  policy_id: string | null;
  policy_version: number | null;
  risk_score: number | string | null;
  restrictions: Record<string, unknown> | null;
  steps: GatewayDecision["steps"];
  mode: GatewayMode;
  enforced: boolean;
  created_at: string;
};

function toGatewayDecision(row: DecisionRow, replayed: boolean): GatewayDecision {
  return {
    decisionId: row.id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    mode: row.mode,
    enforced: row.enforced,
    decision: row.decision,
    effectiveDecision: row.enforced ? row.decision : "ALLOW",
    code: row.code,
    reason: row.reason,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    restrictions: row.restrictions,
    riskScore: row.risk_score === null ? null : Number(row.risk_score),
    steps: row.steps ?? [],
    replayed,
    createdAt: row.created_at,
  };
}

async function findExisting(principal: RuntimePrincipal, requestId: string): Promise<DecisionRow | null> {
  const { data, error } = await supabaseServiceRole()
    .from("runtime_decisions")
    .select()
    .eq("tenant_id", principal.tenantId)
    .eq("agent_id", principal.agentId)
    .eq("request_id", requestId)
    .maybeSingle<DecisionRow>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data && data.tenant_id === principal.tenantId && data.agent_id === principal.agentId ? data : null;
}

export async function authorizeRuntimeRequest(
  principal: RuntimePrincipal & { keyId: string },
  request: RuntimeRequest,
): Promise<GatewayDecision> {
  // Idempotency (§17.6): a request id already decided returns the stored
  // answer, with no new record or audit event. The lookup runs alongside
  // the evaluation rather than before it, so a fresh request (the common
  // case) pays one round trip for both. On a replay the fresh evaluation
  // is discarded.
  const [existing, gatewayState, decision] = await Promise.all([
    findExisting(principal, request.requestId),
    getGatewayMode(principal.tenantId),
    // The key already proved the tenant is active (verifyAgentApiKey).
    // Emergency controls load inside the decision's own parallel wave.
    evaluateRuntimeRequest(principal, request, { tenantActive: true, emergency: loadActiveEmergencyState(principal.tenantId) }),
  ]);
  // A tenant without the gateway gets an error, never a decision to act on.
  if (!gatewayState.enabled) throw new ApiError(403, "GATEWAY_DISABLED", "The Runtime Gateway is not enabled for this organization");
  if (existing) return toGatewayDecision(existing, true);

  const { mode } = gatewayState;
  const enforced = mode === "ENFORCE";
  const correlationId = request.correlationId ?? randomUUID();

  const row = await insertDecision(principal, request, decision, { mode, enforced, correlationId });
  if (!row.replayed) {
    // The decision row above is the durable, synchronous record. The audit
    // entry and the timeline event are written after the response so they
    // add no latency; both log any failure and never throw.
    const decisionRow = row.data;
    runAfterResponse(() =>
      Promise.all([
        writeAudit({
          tenantId: principal.tenantId,
          actorId: null,
          actorType: "integration",
          action: "runtime.decision",
          objectType: "runtime_decision",
          objectId: decisionRow.id,
          outcome: "success",
          correlationId,
          metadata: {
            agentId: principal.agentId,
            apiKeyId: principal.keyId,
            requestId: request.requestId,
            action: request.action,
            application: request.application ?? null,
            tool: request.tool ?? null,
            decision: decision.decision,
            code: decision.code,
            mode,
            enforced,
          },
        }),
        recordDecisionEvent(principal, request, decisionRow, correlationId),
      ]),
    );
  }
  return toGatewayDecision(row.data, row.replayed);
}

async function insertDecision(
  principal: RuntimePrincipal & { keyId: string },
  request: RuntimeRequest,
  decision: RuntimeDecision,
  meta: { mode: GatewayMode; enforced: boolean; correlationId: string },
): Promise<{ data: DecisionRow; replayed: boolean }> {
  const { data, error } = await supabaseServiceRole()
    .from("runtime_decisions")
    .insert({
      tenant_id: principal.tenantId,
      agent_id: principal.agentId,
      api_key_id: principal.keyId,
      request_id: request.requestId,
      correlation_id: meta.correlationId,
      action: request.action,
      application: request.application ?? null,
      resource: request.resource ?? null,
      tool: request.tool ?? null,
      data_classification: request.dataClassification ?? null,
      // Only an identity the decision confirmed belongs to this agent is
      // stored as a reference; a rejected one stays in the reason text.
      identity_id: request.identityId && decision.code !== "UNKNOWN_IDENTITY" ? request.identityId : null,
      decision: decision.decision,
      code: decision.code,
      reason: decision.reason,
      policy_id: decision.policyId ?? null,
      policy_version: decision.policyVersion ?? null,
      risk_score: decision.riskScore ?? null,
      restrictions: decision.restrictions ?? null,
      steps: decision.steps,
      mode: meta.mode,
      enforced: meta.enforced,
    })
    .select()
    .single<DecisionRow>();

  if (error) {
    // Two concurrent deliveries of the same request id: the unique
    // constraint lets exactly one insert win; the other returns the
    // winner's decision.
    if (error.code === "23505") {
      const winner = await findExisting(principal, request.requestId);
      if (winner) return { data: winner, replayed: true };
    }
    throw new ApiError(500, "CREATE_FAILED", error.message);
  }
  return { data, replayed: false };
}

/** The timeline event type for a gateway decision (RUNTIME-P0-16). */
export function decisionEventType(decision: GatewayDecision["decision"], tool: string | undefined): RuntimeEventType {
  if (!tool) return "POLICY_DECISION";
  if (decision === "DENY") return "TOOL_DENIED";
  if (decision === "REQUIRE_APPROVAL") return "TOOL_APPROVAL_REQUIRED";
  return "TOOL_ALLOWED";
}

/**
 * Puts the decision on the agent's runtime timeline, linked to its
 * decision row. Its type is a decision type, never an observed one, so DID
 * does not count it. Idempotent on the decision id.
 */
async function recordDecisionEvent(
  principal: RuntimePrincipal,
  request: RuntimeRequest,
  row: DecisionRow,
  correlationId: string,
): Promise<void> {
  const { error } = await supabaseServiceRole()
    .from("runtime_events")
    .insert({
      tenant_id: principal.tenantId,
      agent_id: principal.agentId,
      identity_id: row.identity_id,
      event_time: row.created_at,
      source: "gateway",
      tool: request.tool ?? null,
      application: request.application ?? null,
      resource: request.resource ?? null,
      action: request.action,
      data_classification: request.dataClassification ?? null,
      success: true,
      raw: { requestId: request.requestId, decision: row.decision, code: row.code, mode: row.mode, enforced: row.enforced },
      dedupe_key: `gateway:${row.id}`,
      correlation_id: correlationId,
      event_type: decisionEventType(row.decision, request.tool),
      session_id: request.context?.sessionId ?? null,
      decision_id: row.id,
    });
  if (error && error.code !== "23505") {
    console.error("gateway decision event insert failed", { decisionId: row.id, error: error.message });
  }
}

/** Decision history for the customer UI: the signed-in user's own tenant, RLS plus an explicit filter. */
export async function listRuntimeDecisions(
  tenantId: string,
  filter: { agentId?: string; limit?: number } = {},
): Promise<GatewayDecisionRecord[]> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("runtime_decisions")
    .select()
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(filter.limit ?? 50, 200));
  if (filter.agentId) query = query.eq("agent_id", filter.agentId);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as DecisionRow[]).map((row) => ({
    ...toGatewayDecision(row, false),
    agentId: row.agent_id,
    action: row.action,
    application: row.application,
    resource: row.resource,
    tool: row.tool,
  }));
}

/**
 * RUNTIME-P0-18 / master P0-34 — which tools the agent may be shown.
 * In OBSERVE_ONLY mode nothing is hidden: every tool comes back visible,
 * and `wouldHide` lists what enforcement would remove and why. Filtering
 * never replaces authorization; every call still goes through /authorize.
 */
export async function filterGatewayTools(
  principal: RuntimePrincipal,
  raw: unknown,
): Promise<{ mode: GatewayMode; enforced: boolean; visible: string[]; wouldHide: ToolVisibility[] }> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ApiError(400, "VALIDATION_FAILED", "body: must be a JSON object");
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.tools) || body.tools.length === 0 || body.tools.length > 200) {
    throw new ApiError(400, "VALIDATION_FAILED", "tools: must be a list of 1 to 200 tool names");
  }
  const tools = body.tools.map((t, i) => {
    if (typeof t !== "string" || !t.trim() || t.length > MAX_FIELD) throw new ApiError(400, "VALIDATION_FAILED", `tools[${i}]: must be a tool name`);
    return t.trim();
  });
  const mcpServer = optionalString(body, "mcpServer");

  const [gatewayState, results] = await Promise.all([
    getGatewayMode(principal.tenantId),
    evaluateToolVisibility(principal, tools, {
    tenantActive: true,
      emergency: loadActiveEmergencyState(principal.tenantId),
      mcpServer,
    }),
  ]);
  if (!gatewayState.enabled || !gatewayState.toolFiltering) {
    throw new ApiError(403, "FEATURE_DISABLED", "Tool filtering is not enabled for this organization");
  }
  const { mode } = gatewayState;
  const hidden = results.filter((r) => !r.visible);
  const enforced = mode === "ENFORCE";
  return {
    mode,
    enforced,
    visible: enforced ? results.filter((r) => r.visible).map((r) => r.tool) : tools,
    wouldHide: hidden,
  };
}
