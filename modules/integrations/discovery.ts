import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { getApplicationDetail, listApplicationsForMatching, registerApplication } from "@/modules/access-governance/service";
import { getIntegration } from "./integrations";
import { getNormalizedObjects } from "./objects";
import {
  DISCOVERY_SOURCE_KINDS,
  DISCOVERY_STATUSES,
  allowedDecisions,
  candidateFromIntegrationObject,
  candidateFromManual,
  candidateFromOpenApi,
  candidateFromScim,
  matchCatalog,
  parseJsonDocument,
  type CatalogEntry,
  type DiscoveryCandidate,
  type DiscoverySourceKind,
  type DiscoveryStatus,
} from "./discoveryRules";

/**
 * INTEGRATION-P0-10 — application discovery. Candidates come from a
 * connector's imported applications, an OpenAPI document, SCIM metadata or
 * a manual report; each is matched to the catalog (Access's published
 * contract) or held as UNRECOGNIZED until a person registers it, links it,
 * records an exception or ignores it with a reason. Ignored ones stay.
 *
 * Reads run as the user (RLS) with an explicit tenant filter. Members have
 * no write policy on discoveries, so the service writes them with the
 * service role, always filtered by the tenant resolved from the session,
 * after the route checked the permission. Every decision is audited.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAST: Record<DiscoveryDecision["action"], string> = { register: "registered", link: "linked", exception: "excepted", ignore: "ignored", reopen: "reopened" };
/** The most applications one connector discovery reads (CLAUDE.md §15). */
export const DISCOVERY_CAP = 2000;

export type ApplicationDiscovery = {
  id: string;
  source: DiscoverySourceKind;
  sourceIntegrationId: string | null;
  name: string;
  vendor: string | null;
  url: string | null;
  description: string | null;
  evidence: Record<string, unknown>;
  status: DiscoveryStatus;
  applicationId: string | null;
  suggestedApplicationId: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  exceptionUntil: string | null;
  sightings: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

type Row = Record<string, unknown>;

function toDiscovery(r: Row): ApplicationDiscovery {
  return {
    id: r.id as string,
    source: r.source as DiscoverySourceKind,
    sourceIntegrationId: (r.source_integration_id as string | null) ?? null,
    name: r.name as string,
    vendor: (r.vendor as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    evidence: (r.evidence as Record<string, unknown>) ?? {},
    status: r.status as DiscoveryStatus,
    applicationId: (r.application_id as string | null) ?? null,
    suggestedApplicationId: (r.suggested_application_id as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    exceptionUntil: (r.exception_until as string | null) ?? null,
    sightings: Number(r.sightings),
    firstSeenAt: r.first_seen_at as string,
    lastSeenAt: r.last_seen_at as string,
  };
}

export type DiscoveryFilter = { status?: DiscoveryStatus; source?: DiscoverySourceKind; q?: string; page?: number; pageSize?: number };

export async function listDiscoveries(tenantId: string, filter: DiscoveryFilter = {}): Promise<{ rows: ApplicationDiscovery[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const supabase = await supabaseServer();
  let query = supabase.from("application_discoveries").select("*", { count: "exact" }).eq("tenant_id", tenantId);
  if (filter.status && (DISCOVERY_STATUSES as readonly string[]).includes(filter.status)) query = query.eq("status", filter.status);
  if (filter.source && (DISCOVERY_SOURCE_KINDS as readonly string[]).includes(filter.source)) query = query.eq("source", filter.source);
  const q = filter.q?.trim().replace(/[%_,()*\\]/g, " ").trim();
  if (q) query = query.or(`name.ilike.%${q}%,vendor.ilike.%${q}%,url.ilike.%${q}%`);
  const { data, error, count } = await query
    .order("last_seen_at", { ascending: false })
    .order("id", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return { rows: (data ?? []).map(toDiscovery), total: count ?? 0 };
}

export async function getDiscoveryCounts(tenantId: string): Promise<Record<DiscoveryStatus, number>> {
  const supabase = await supabaseServer();
  const entries = await Promise.all(
    DISCOVERY_STATUSES.map(async (s) => {
      const { count, error } = await supabase.from("application_discoveries").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", s);
      if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
      return [s, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<DiscoveryStatus, number>;
}

export async function getDiscovery(tenantId: string, id: string): Promise<ApplicationDiscovery | null> {
  if (!UUID_RE.test(id)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("application_discoveries").select().eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toDiscovery(data) : null;
}

export type DiscoveryRunResult = { found: number; created: number; seenAgain: number; matched: number; unrecognized: number; skipped: number };

/**
 * Records candidates: a new one is matched to the catalog or held as
 * UNRECOGNIZED; one seen before only gains a sighting and fresh evidence,
 * so a person's decision (registered, ignored, excepted) is never undone
 * by the next discovery.
 */
async function recordCandidates(tenantId: string, actorId: string, candidates: DiscoveryCandidate[], integrationId: string | null, skipped = 0): Promise<DiscoveryRunResult & { ids: string[] }> {
  const admin = supabaseServiceRole();
  const catalog: CatalogEntry[] = await listApplicationsForMatching(tenantId);
  const unique = [...new Map(candidates.map((c) => [`${c.source}|${c.sourceKey}`, c])).values()];
  const result: DiscoveryRunResult & { ids: string[] } = { found: unique.length, created: 0, seenAgain: 0, matched: 0, unrecognized: 0, skipped, ids: [] };
  const now = new Date().toISOString();
  for (let i = 0; i < unique.length; i += 200) {
    const batch = unique.slice(i, i + 200);
    const { data: existing, error } = await admin
      .from("application_discoveries")
      .select("id, source, source_key, sightings")
      .eq("tenant_id", tenantId)
      .in("source_key", batch.map((c) => c.sourceKey));
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const seen = new Map((existing ?? []).map((r) => [`${r.source}|${r.source_key}`, r as { id: string; sightings: number }]));
    for (const c of batch) {
      const prior = seen.get(`${c.source}|${c.sourceKey}`);
      if (prior) {
        const { error: upError } = await admin
          .from("application_discoveries")
          .update({ evidence: c.evidence, last_seen_at: now, sightings: prior.sightings + 1, ...(c.url ? { url: c.url } : {}) })
          .eq("tenant_id", tenantId)
          .eq("id", prior.id);
        if (upError) throw new ApiError(500, "UPDATE_FAILED", upError.message);
        result.seenAgain++;
        result.ids.push(prior.id);
        continue;
      }
      const match = matchCatalog(c, catalog);
      const { data: created, error: insError } = await admin
        .from("application_discoveries")
        .insert({
          tenant_id: tenantId,
          source: c.source,
          source_integration_id: integrationId,
          source_key: c.sourceKey,
          name: c.name,
          vendor: c.vendor,
          url: c.url,
          description: c.description,
          evidence: c.evidence,
          status: match.applicationId ? "MATCHED" : "UNRECOGNIZED",
          application_id: match.applicationId,
          suggested_application_id: match.suggestedApplicationId,
          created_by: actorId,
        })
        .select("id")
        .single();
      if (insError || !created) throw new ApiError(500, "CREATE_FAILED", insError?.message ?? "Could not record the discovery");
      result.created++;
      result.ids.push(created.id);
      if (match.applicationId) result.matched++;
      else result.unrecognized++;
    }
  }
  return result;
}

async function auditDiscovery(tenantId: string, actorId: string, action: string, object: { type: "application_discovery" | "integration"; id: string }, metadata: Record<string, unknown>) {
  await writeAudit({ tenantId, actorId, actorType: "user", action: `application_discovery.${action}`, objectType: object.type, objectId: object.id, outcome: "success", metadata });
}

/** Discovers the applications a connector already imported. Reads only its stored objects. */
export async function discoverFromIntegration(tenantId: string, actorId: string, integrationId: unknown): Promise<DiscoveryRunResult> {
  if (typeof integrationId !== "string" || !UUID_RE.test(integrationId)) throw new ApiError(400, "VALIDATION_FAILED", "integrationId: an integration id");
  const integration = await getIntegration(tenantId, integrationId);
  if (!integration) throw new ApiError(404, "NOT_FOUND", "integrationId: that integration is not in this organization");
  const objects = await getNormalizedObjects(tenantId, integrationId, "application");
  if (objects.length > DISCOVERY_CAP) throw new ApiError(413, "TOO_MANY", `The connector imported ${objects.length} applications; one discovery reads at most ${DISCOVERY_CAP}`);
  const candidates = objects.map(candidateFromIntegrationObject);
  // Keyed per connector, so two connectors' identical ids never collide.
  const usable = candidates.filter((c): c is DiscoveryCandidate => c !== null).map((c) => ({ ...c, sourceKey: `${integrationId}:${c.sourceKey}`.slice(0, 300) }));
  const { ids: _ids, ...result } = await recordCandidates(tenantId, actorId, usable, integrationId, candidates.length - usable.length);
  void _ids;
  await auditDiscovery(tenantId, actorId, "discovered", { type: "integration", id: integrationId }, { source: "integration", ...result });
  return result;
}

/** One application from a pasted OpenAPI document, SCIM metadata, or a manual report. */
export async function submitDiscovery(tenantId: string, actorId: string, input: Record<string, unknown>): Promise<{ discovery: ApplicationDiscovery; created: boolean }> {
  let candidate: DiscoveryCandidate;
  if (input.kind === "openapi") candidate = candidateFromOpenApi(parseJsonDocument(input.document, "document"));
  else if (input.kind === "scim") candidate = candidateFromScim({ name: input.name, baseUrl: input.baseUrl, metadata: parseJsonDocument(input.metadata, "metadata") });
  else if (input.kind === "manual") candidate = candidateFromManual({ name: input.name, vendor: input.vendor, url: input.url, description: input.description });
  else throw new ApiError(400, "VALIDATION_FAILED", "kind: openapi, scim or manual");
  const result = await recordCandidates(tenantId, actorId, [candidate], null);
  const discovery = (await getDiscovery(tenantId, result.ids[0]))!;
  await auditDiscovery(tenantId, actorId, "discovered", { type: "application_discovery", id: discovery.id }, { source: candidate.source, created: result.created === 1, status: discovery.status });
  return { discovery, created: result.created === 1 };
}

export type DiscoveryDecision = {
  action: "register" | "link" | "exception" | "ignore" | "reopen";
  note?: unknown;
  applicationId?: unknown;
  exceptionUntil?: unknown;
  /** register: catalog fields for the new application (owners, risk, classification, type). */
  application?: Record<string, unknown>;
  /** register: link the new application to the connector that found it. */
  connect?: unknown;
};

/**
 * A person's decision on a discovery. Registering creates the catalog
 * application through Access's published contract (its validation and
 * owner checks apply). Every decision is a conditional update on the
 * status it expects (409 if someone decided first) and is audited.
 */
export async function decideDiscovery(tenantId: string, actorId: string, id: string, decision: DiscoveryDecision): Promise<ApplicationDiscovery> {
  if (!Object.prototype.hasOwnProperty.call(PAST, decision.action)) throw new ApiError(400, "VALIDATION_FAILED", "action: register, link, exception, ignore or reopen");
  const d = await getDiscovery(tenantId, id);
  if (!d) throw new ApiError(404, "NOT_FOUND", "No such discovery");
  if (!allowedDecisions(d.status).includes(decision.action)) throw new ApiError(409, "INVALID_STATE", `A ${d.status.toLowerCase()} discovery cannot be ${PAST[decision.action] ?? "changed"}`);
  const note = typeof decision.note === "string" && decision.note.trim() ? decision.note.trim().slice(0, 2000) : null;
  const now = new Date().toISOString();
  let patch: Row;
  let applicationId: string | null = null;

  switch (decision.action) {
    case "register": {
      const fields = { name: d.name, vendor: d.vendor ?? undefined, url: d.url ?? undefined, description: d.description ?? undefined, ...(decision.application ?? {}) };
      const connect = decision.connect === true || decision.connect === "true" || decision.connect === "on";
      const app = await registerApplication(tenantId, actorId, fields, {
        discoverySource: d.source === "manual" ? "manual" : d.source,
        sourceIntegrationId: connect ? d.sourceIntegrationId : null,
      });
      applicationId = app.id;
      patch = { status: "REGISTERED", application_id: app.id, decision_note: note };
      break;
    }
    case "link": {
      if (typeof decision.applicationId !== "string" || !UUID_RE.test(decision.applicationId)) throw new ApiError(400, "VALIDATION_FAILED", "applicationId: choose an application");
      const app = await getApplicationDetail(tenantId, decision.applicationId);
      if (!app) throw new ApiError(404, "NOT_FOUND", "applicationId: that application is not in this organization");
      applicationId = app.id;
      patch = { status: "MATCHED", application_id: app.id, decision_note: note };
      break;
    }
    case "exception": {
      if (!note) throw new ApiError(400, "VALIDATION_FAILED", "note: say why this is an exception");
      const until = typeof decision.exceptionUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(decision.exceptionUntil) ? decision.exceptionUntil : null;
      if (!until) throw new ApiError(400, "VALIDATION_FAILED", "exceptionUntil: the date the exception ends");
      if (until <= now.slice(0, 10)) throw new ApiError(400, "VALIDATION_FAILED", "exceptionUntil: a date in the future");
      patch = { status: "EXCEPTION", decision_note: note, exception_until: until };
      break;
    }
    case "ignore":
      if (!note) throw new ApiError(400, "VALIDATION_FAILED", "note: say why it is ignored");
      patch = { status: "IGNORED", decision_note: note };
      break;
    case "reopen":
      patch = { status: "UNRECOGNIZED", decision_note: note, exception_until: null };
      break;
    default:
      throw new ApiError(400, "VALIDATION_FAILED", "action: register, link, exception, ignore or reopen");
  }

  const { data, error } = await supabaseServiceRole()
    .from("application_discoveries")
    .update({ ...patch, decided_by: actorId, decided_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("status", d.status)
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(409, "CONFLICT", "Someone decided on this discovery meanwhile; reload");
  await auditDiscovery(tenantId, actorId, PAST[decision.action], { type: "application_discovery", id }, {
    name: d.name,
    from: d.status,
    to: data.status,
    applicationId,
    note,
  });
  return toDiscovery(data);
}
