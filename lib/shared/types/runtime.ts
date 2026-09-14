/**
 * Shared contracts owned by the Runtime Agent (docs/plan/05-RUNTIME-AGENT-BACKLOG.md).
 * Other modules import these instead of redefining runtime-event shapes, and
 * must read/write runtime data only through modules/runtime-assurance/service.ts
 * — never by querying runtime_events/runtime_tools/runtime_resources directly.
 */

export type RuntimeEventSource = "mcp" | "rest" | "webhook";

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

/** SHOULD, reduced from the active Agent Contract to the comparison shape. */
export type ShouldEntry = {
  application: string;
  data: string | null;
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
  | "behavioral_violation";

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
};
