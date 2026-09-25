/**
 * Shared contracts owned by the Runtime Agent (docs/plan/05-RUNTIME-AGENT-BACKLOG.md).
 * Other modules import these instead of redefining runtime-event shapes, and
 * must read/write runtime data only through modules/runtime-assurance/service.ts
 * — never by querying runtime_events/runtime_tools/runtime_resources directly.
 */

export type RuntimeEventSource = "mcp" | "rest" | "webhook" | "gateway";

// RUNTIME-P0-16 (master stories P0-18) — the normalized event vocabulary.
export const RUNTIME_EVENT_TYPES = [
  "AUTHENTICATION",
  "SESSION_STARTED",
  "SESSION_ENDED",
  "TOOL_REQUEST",
  "TOOL_ALLOWED",
  "TOOL_DENIED",
  "TOOL_APPROVAL_REQUIRED",
  "TOOL_EXECUTED",
  "API_CALL",
  "DATA_ACCESS",
  "DELEGATION",
  "POLICY_DECISION",
] as const;
export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

/**
 * The event types that record something an agent actually DID. DID and
 * the SHOULD/CAN/DID comparison read only these. A gateway decision or a
 * tool *request* is not an action, and counting it would distort DID.
 */
export const OBSERVED_EVENT_TYPES: readonly RuntimeEventType[] = ["TOOL_EXECUTED", "API_CALL", "DATA_ACCESS", "DELEGATION"];

export type RuntimeEvent = {
  id: string;
  tenantId: string;
  agentId: string;
  identityId: string | null;
  eventTime: string;
  receivedAt: string;
  source: RuntimeEventSource;
  tool: string | null;
  application: string | null;
  resource: string | null;
  action: string;
  dataClassification: string | null;
  success: boolean;
  raw: Record<string, unknown>;
  dedupeKey: string;
  correlationId: string | null;
  createdAt: string;
  eventType: RuntimeEventType;
  sessionId: string | null;
  decisionId: string | null;
  mcpServer: string | null;
};

/**
 * Input to ingestRuntimeEvent(). `dedupeKey` is optional — if the source
 * doesn't provide its own idempotency key, one is computed deterministically
 * from (source, tool, application, resource, action, eventTime, agentId).
 */
export type RuntimeEventInput = {
  agentId: string;
  identityId?: string | null;
  eventTime: string;
  source: RuntimeEventSource;
  tool?: string | null;
  application?: string | null;
  resource?: string | null;
  action: string;
  dataClassification?: string | null;
  success: boolean;
  raw?: Record<string, unknown>;
  correlationId?: string | null;
  dedupeKey?: string;
  /** Omitted: inferred as ingestRuntimeEvent() documents (TOOL_EXECUTED / DATA_ACCESS / API_CALL). */
  eventType?: RuntimeEventType;
  sessionId?: string | null;
  mcpServer?: string | null;
};

export type RuntimeTool = {
  id: string;
  tenantId: string;
  agentId: string | null;
  name: string;
  sourceIntegrationId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type RuntimeResource = {
  id: string;
  tenantId: string;
  application: string;
  resource: string;
  dataClassification: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

// RUNTIME-P0-11 — Ingestion Hardening: Replay Protection & Event Quarantine.
export type RuntimeEventQuarantineEntry = {
  id: string;
  tenantId: string;
  agentId: string | null;
  reason: string;
  source: string | null;
  action: string | null;
  submittedEventTime: string | null;
  attemptedDedupeKey: string | null;
  receivedAt: string;
};

export type RuntimeEventFilter = {
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
};

export type RuntimeEventPage = {
  events: RuntimeEvent[];
  nextCursor: string | null;
};

/** One distinct {application, resource, action, data_classification} tuple actually observed. */
export type DidTuple = {
  application: string | null;
  resource: string | null;
  action: string;
  dataClassification: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  /** id of a representative runtime_events row for this tuple — evidence for Risk Agent. */
  sampleEventId: string;
};

export type DidSummary = {
  agentId: string;
  windowStart: string;
  windowEnd: string;
  tuples: DidTuple[];
};

/**
 * RUNTIME-P0-14 — Runtime Data Quality Tracking. Computed on demand over
 * runtime_events (not a separate stored table — "queryable" is satisfied by
 * a real aggregate query, not necessarily a materialized one; see the
 * Runtime Agent audit log for this documented scoping decision).
 */
export type RuntimeDataQualityMetrics = {
  tenantId: string;
  agentId: string | null;
  windowStart: string;
  windowEnd: string;
  totalEvents: number;
  missingIdentityCount: number;
  unknownResourceCount: number;
};

/**
 * SHOULD, reduced from the active Agent Contract to the comparison shape.
 * RUNTIME-P0-12 — normalized toward the new requirements doc's fuller
 * vocabulary (tools/actions, not only application/data) so
 * compareShouldCanDid can be extended onto those dimensions without another
 * schema change; P0 populates them from the contract's existing
 * approvedActions field but does not yet compare on them.
 */
export type ShouldEntry = {
  application: string;
  data: string | null;
  actions?: string[];
  tools?: string[];
};

/** CAN, reduced from getEffectiveAccess() to the comparison shape. */
export type CanEntry = {
  application: string;
  dataClassification: string | null;
  entitlementName?: string;
  grantId: string;
};

/** DID, reduced from getDid() to the comparison shape. */
export type DidEntry = {
  application: string | null;
  resource: string | null;
  dataClassification: string | null;
  eventId: string;
};

export type ComparisonOutcomeType =
  | "healthy"
  | "excessive_access"
  | "insufficient_access"
  | "unused_capability"
  | "unexpected_capability"
  | "behavioral_violation"
  /** RUNTIME-P0-14 — a DID tuple with no resolvable application (unknown
   * resource/identity) must never be silently scored as either compliant
   * or a violation; it is surfaced as its own, distinct outcome instead. */
  | "unscored_unknown"
  /** RUNTIME-P0-17 — a tool the agent was observed using that its contract's allowed tools do not include. */
  | "unapproved_tool";

/**
 * RUNTIME-P0-17 — NOW: the agent's most recent gateway request, checked
 * against its approved purpose (SHOULD) and effective access (CAN) by the
 * deterministic decision engine at the time it was made.
 */
export type NowEntry = {
  decisionId: string;
  requestId: string;
  action: string;
  application: string | null;
  tool: string | null;
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "ALLOW_WITH_RESTRICTIONS";
  code: string;
  reason: string;
  /** How the request stood against SHOULD: approved, needs approval, refused, or not evaluated. */
  approved: "approved" | "requires_approval" | "not_approved" | "not_evaluated";
  /** How it stood against CAN: within effective access, outside it, or not evaluated. */
  effective: "within" | "outside" | "not_evaluated";
  enforced: boolean;
  at: string;
};

export type ComparisonOutcome = {
  type: ComparisonOutcomeType;
  /** The specific stored row(s) that produced this outcome — no unattributed conclusions. */
  evidence: Record<string, unknown>;
};

export type ShouldCanDidComparison = {
  agentId: string;
  should: ShouldEntry[];
  can: CanEntry[];
  did: DidEntry[];
  outcomes: ComparisonOutcome[];
  evaluatedAt: string;
  /** RUNTIME-P0-17 — distinct tools the agent was observed using (observed event types only). */
  didTools: string[];
  /** RUNTIME-P0-17 — the current request. Null when there is none, or for an as-of (historical) comparison. */
  now: NowEntry | null;
  /**
   * RUNTIME-P0-12 — true when the agent's active contract is missing or has
   * an unset/ambiguous purpose, meaning SHOULD itself is not well-formed.
   * Never silently treated as either "fully permitted" (should=[]) or
   * "fully denied" — a caller (Risk Agent) must check this explicitly
   * rather than infer it from should.length === 0, which could also mean a
   * genuinely empty, well-formed contract.
   */
  shouldUnknown: boolean;
};

// RUNTIME-P0-15 — the Runtime Gateway's answer (master stories §12, plus
// the operating mode). In OBSERVE_ONLY mode (the default, per the user's
// 2026-09-25 decision) `decision` is what enforcement WOULD do, and
// `effectiveDecision` is what the caller must actually do: ALLOW. Nothing
// is blocked until a tenant is moved to ENFORCE.
export type GatewayMode = "OBSERVE_ONLY" | "ENFORCE";

export type GatewayDecision = {
  decisionId: string;
  requestId: string;
  correlationId: string;
  mode: GatewayMode;
  enforced: boolean;
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "ALLOW_WITH_RESTRICTIONS";
  effectiveDecision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "ALLOW_WITH_RESTRICTIONS";
  code: string;
  reason: string;
  policyId: string | null;
  policyVersion: number | null;
  restrictions: Record<string, unknown> | null;
  riskScore: number | null;
  steps: Array<{ step: string; outcome: string; code: string; reason: string }>;
  /** True when this is the stored answer to a request id already decided. */
  replayed: boolean;
  createdAt: string;
};

export type GatewayDecisionRecord = GatewayDecision & {
  agentId: string;
  action: string;
  application: string | null;
  resource: string | null;
  tool: string | null;
};
