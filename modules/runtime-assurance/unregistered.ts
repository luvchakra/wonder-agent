import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RuntimeEvent, RuntimeEventInput, UnregisteredAgentActivity } from "@/lib/shared/types/runtime";
import { requireFeature } from "@/modules/platform-admin/service";
import { resolveAgentReference } from "@/modules/agent-identity/service";
import { ingestRuntimeEvent, isWithinReplayWindow } from "./events";
import { quarantineEvent } from "./quarantine";

/**
 * IDENTITY-P0-12 (master P0-09) — Shadow AI evidence, Runtime's side.
 *
 * An event whose agent reference matches no registered agent is
 * quarantined with reason UNREGISTERED_AGENT (see the events route): it is
 * never recorded as runtime activity, so it never counts as DID, and it is
 * never silently dropped. This is the published read Identity's discovery
 * inbox uses to surface those agents for a person to register, link or
 * ignore.
 *
 * Reads run as the calling user under RLS (client SELECT on the quarantine
 * table), with an explicit tenant filter as defence in depth (§14).
 */
export const UNREGISTERED_AGENT = "UNREGISTERED_AGENT";
export const AMBIGUOUS_AGENT = "AMBIGUOUS_AGENT";

const WINDOW_DAYS = 90;
const MAX_ROWS = 2000;

type Row = { observed_agent_ref: string | null; source: string | null; application: string | null; tool: string | null; action: string | null; received_at: string };

/** Pure: groups quarantine rows by agent reference, newest activity first. */
export function groupUnregisteredActivity(rows: Row[]): UnregisteredAgentActivity[] {
  const byRef = new Map<string, UnregisteredAgentActivity & { _s: Set<string>; _a: Set<string>; _t: Set<string>; _x: Set<string> }>();
  for (const r of rows) {
    const ref = r.observed_agent_ref?.trim();
    if (!ref) continue;
    let g = byRef.get(ref);
    if (!g) {
      g = { agentRef: ref, eventCount: 0, firstSeenAt: r.received_at, lastSeenAt: r.received_at, sources: [], applications: [], tools: [], actions: [], _s: new Set(), _a: new Set(), _t: new Set(), _x: new Set() };
      byRef.set(ref, g);
    }
    g.eventCount += 1;
    if (r.received_at < g.firstSeenAt) g.firstSeenAt = r.received_at;
    if (r.received_at > g.lastSeenAt) g.lastSeenAt = r.received_at;
    if (r.source) g._s.add(r.source);
    if (r.application) g._a.add(r.application);
    if (r.tool) g._t.add(r.tool);
    if (r.action) g._x.add(r.action);
  }
  return [...byRef.values()]
    .map(({ _s, _a, _t, _x, ...g }) => ({ ...g, sources: [..._s].sort(), applications: [..._a].sort(), tools: [..._t].sort(), actions: [..._x].sort() }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export async function listUnregisteredAgentActivity(tenantId: string): Promise<UnregisteredAgentActivity[]> {
  const supabase = await supabaseServer();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("runtime_event_quarantine")
    .select("observed_agent_ref, source, application, tool, action, received_at")
    .eq("tenant_id", tenantId)
    .eq("reason", UNREGISTERED_AGENT)
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return groupUnregisteredActivity((data ?? []) as Row[]);
}

/**
 * The event route's handling of an agent reference Identity could not
 * resolve to exactly one registered agent. Same gates as a normal
 * ingestion, in the same order: runtime monitoring must be on for the
 * tenant, and an event outside the replay window is quarantined as such
 * rather than as discovery evidence. Always throws, so the caller can
 * never go on to record the event.
 */
export async function quarantineUnresolvedAgentEvent(
  tenantId: string,
  kind: "none" | "ambiguous",
  details: {
    observedAgentRef: string;
    source: string;
    action: string;
    application: string | null;
    tool: string | null;
    submittedEventTime: string;
    attemptedDedupeKey: string | null;
  },
): Promise<never> {
  await requireFeature(tenantId, "runtime_monitoring");
  if (!isWithinReplayWindow(details.submittedEventTime)) {
    await quarantineEvent(tenantId, "REPLAY_WINDOW_VIOLATION", details);
    throw new ApiError(422, "REPLAY_WINDOW_VIOLATION", "eventTime is outside the accepted ingestion window");
  }
  if (kind === "none") {
    await quarantineEvent(tenantId, UNREGISTERED_AGENT, details);
    throw new ApiError(404, "AGENT_NOT_REGISTERED", "No registered agent matches this reference. The event was quarantined for discovery, not recorded.");
  }
  await quarantineEvent(tenantId, AMBIGUOUS_AGENT, details);
  throw new ApiError(409, "AGENT_REFERENCE_AMBIGUOUS", "This reference is linked to more than one agent. The event was quarantined for review, not recorded.");
}

/**
 * The published ingestion entry point for a source that names its agent
 * by reference: the events API (IDENTITY-P0-12) and the MCP bridge
 * (INTEGRATION-P0-07). The reference is a WonderAgent agent id or a
 * linked identity's external reference, resolved by Identity by exact
 * identifier only (§17.6). A unique agent is ingested normally, with
 * dedupe, the replay window and the monitoring flag. Anything else is
 * quarantined and refused, never recorded. An event outside the replay
 * window is quarantined as such either way.
 */
export async function ingestRuntimeEventByReference(
  tenantId: string,
  actorId: string | null,
  reference: string,
  input: Omit<RuntimeEventInput, "agentId">,
): Promise<{ event: RuntimeEvent; deduped: boolean }> {
  const evidence = {
    observedAgentRef: reference,
    source: input.source,
    action: input.action,
    application: input.application ?? null,
    tool: input.tool ?? null,
    submittedEventTime: input.eventTime,
    attemptedDedupeKey: input.dedupeKey ?? null,
  };
  const resolved = await resolveAgentReference(tenantId, reference);
  if (resolved.kind !== "unique") return quarantineUnresolvedAgentEvent(tenantId, resolved.kind, evidence);

  const full: RuntimeEventInput = { ...input, agentId: resolved.agentId, identityId: input.identityId ?? resolved.identityId ?? null };
  try {
    return await ingestRuntimeEvent(tenantId, actorId, full);
  } catch (err) {
    if (err instanceof ApiError && err.code === "REPLAY_WINDOW_VIOLATION") {
      await quarantineEvent(tenantId, err.code, { ...evidence, agentId: resolved.agentId });
    }
    throw err;
  }
}
