import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { IdentityType } from "@/lib/shared/types/agent-identity";
import { getNormalizedObjects } from "@/modules/integrations/service";
import { getIdentity, getIdentityNames, listIdentitiesForCorrelation } from "@/modules/agent-identity/service";
import {
  DEFAULT_DORMANT_DAYS,
  dormantCutoff,
  isDormant,
  planReconciliation,
  type AccountType,
  type Correlation,
  type CorrelationRule,
  type ExistingAccount,
} from "./accountRules";

/**
 * ACCESS-P0-17 — the account inventory: every application account with
 * the identity it belongs to (people, external, machine and AI agents),
 * orphan, ambiguous and dormant accounts, and reconciliation of an
 * application's accounts against its connector under the configuration
 * onboarding promoted (ACCESS-P0-16).
 *
 * Reads run as the user (RLS) with an explicit tenant filter. Account
 * writes run as the user under the accounts table's member policies after
 * `access.manage` is checked by the caller; reconciliation run records are
 * written with the service role (members only read them), always filtered
 * by the tenant resolved from the session.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The most source accounts one run reconciles (CLAUDE.md §15). */
export const RECONCILE_CAP = 5000;
const NON_AGENT_TYPES: IdentityType[] = ["HUMAN", "EXTERNAL", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API", "MACHINE"];

export type AccountView = "all" | "orphan" | "ambiguous" | "dormant" | "privileged" | "missing";
export const ACCOUNT_VIEWS: AccountView[] = ["all", "orphan", "ambiguous", "dormant", "privileged", "missing"];

export type InventoryAccount = {
  id: string;
  externalAccountRef: string;
  accountName: string | null;
  applicationId: string;
  applicationName: string;
  agentId: string | null;
  identityId: string | null;
  identityName: string | null;
  identityType: IdentityType | null;
  correlation: Correlation;
  accountType: AccountType;
  status: "active" | "disabled";
  source: "manual" | "reconciliation";
  sourceIntegrationId: string | null;
  lastUsedAt: string | null;
  lastSeenAt: string | null;
  missingFromSourceAt: string | null;
  createdAt: string;
  updatedAt: string;
  dormant: boolean;
};

export type AccountFilter = { view?: AccountView; applicationId?: string; q?: string; dormantDays?: number; page?: number; pageSize?: number };

const COLUMNS =
  "id, external_account_ref, account_name, application_id, agent_id, identity_id, correlation, account_type, status, source, source_integration_id, last_used_at, last_seen_at, missing_from_source_at, created_at, updated_at, applications(name, display_name)";

type Row = Record<string, unknown> & { applications: { name: string; display_name: string | null } | null };

function toAccount(r: Row, names: Map<string, { displayName: string; identityType: IdentityType }>, now: Date, days: number): InventoryAccount {
  const identityId = (r.identity_id as string | null) ?? null;
  const who = identityId ? names.get(identityId) : undefined;
  const a = {
    id: r.id as string,
    externalAccountRef: r.external_account_ref as string,
    accountName: (r.account_name as string | null) ?? null,
    applicationId: r.application_id as string,
    applicationName: r.applications?.display_name ?? r.applications?.name ?? "Unknown application",
    agentId: (r.agent_id as string | null) ?? null,
    identityId,
    identityName: who?.displayName ?? null,
    identityType: who?.identityType ?? null,
    correlation: r.correlation as Correlation,
    accountType: r.account_type as AccountType,
    status: r.status as "active" | "disabled",
    source: r.source as "manual" | "reconciliation",
    sourceIntegrationId: (r.source_integration_id as string | null) ?? null,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    missingFromSourceAt: (r.missing_from_source_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
  return { ...a, dormant: isDormant(a, now, days) };
}

// PostgREST filter for "not used since the cutoff": never used and created before it, or last used before it.
const dormantOr = (cutoff: string) => `last_used_at.lt.${cutoff},and(last_used_at.is.null,created_at.lt.${cutoff})`;

function applyView<Q extends { eq: (c: string, v: unknown) => Q; in: (c: string, v: unknown[]) => Q; or: (f: string) => Q; not: (c: string, op: string, v: unknown) => Q }>(
  query: Q,
  view: AccountView,
  cutoff: string,
): Q {
  switch (view) {
    case "orphan":
      return query.eq("correlation", "orphan");
    case "ambiguous":
      return query.eq("correlation", "ambiguous");
    case "dormant":
      return query.eq("status", "active").or(dormantOr(cutoff));
    case "privileged":
      return query.in("account_type", ["privileged", "shared"]);
    case "missing":
      return query.not("missing_from_source_at", "is", null);
    default:
      return query;
  }
}

export async function listAccountInventory(tenantId: string, filter: AccountFilter = {}): Promise<{ rows: InventoryAccount[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const days = filter.dormantDays ?? DEFAULT_DORMANT_DAYS;
  const now = new Date();
  const supabase = await supabaseServer();
  let query = supabase.from("accounts").select(COLUMNS, { count: "exact" }).eq("tenant_id", tenantId);
  if (filter.applicationId && UUID_RE.test(filter.applicationId)) query = query.eq("application_id", filter.applicationId);
  query = applyView(query, filter.view ?? "all", dormantCutoff(now, days));
  const q = filter.q?.trim().replace(/[%_,()*\\]/g, " ").trim();
  if (q) query = query.or(`account_name.ilike.%${q}%,external_account_ref.ilike.%${q}%`);
  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1)
    .returns<Row[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const names = await getIdentityNames(tenantId, (data ?? []).map((r) => r.identity_id as string).filter(Boolean));
  return { rows: (data ?? []).map((r) => toAccount(r, names, now, days)), total: count ?? 0 };
}

export type AccountSummary = { total: number; correlated: number; orphan: number; ambiguous: number; dormant: number; privileged: number; missing: number };

/** The counts behind the inventory's cards, in parallel (§15). */
export async function getAccountSummary(tenantId: string, opts: { applicationId?: string; dormantDays?: number } = {}): Promise<AccountSummary> {
  const supabase = await supabaseServer();
  const cutoff = dormantCutoff(new Date(), opts.dormantDays ?? DEFAULT_DORMANT_DAYS);
  const count = async (view: AccountView | "correlated") => {
    let query = supabase.from("accounts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if (opts.applicationId && UUID_RE.test(opts.applicationId)) query = query.eq("application_id", opts.applicationId);
    query = view === "correlated" ? query.in("correlation", ["correlated", "manual"]) : applyView(query, view, cutoff);
    const { count: n, error } = await query;
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    return n ?? 0;
  };
  const [total, correlated, orphan, ambiguous, dormant, privileged, missing] = await Promise.all([
    count("all"),
    count("correlated"),
    count("orphan"),
    count("ambiguous"),
    count("dormant"),
    count("privileged"),
    count("missing"),
  ]);
  return { total, correlated, orphan, ambiguous, dormant, privileged, missing };
}

export async function getInventoryAccount(tenantId: string, accountId: string, dormantDays = DEFAULT_DORMANT_DAYS): Promise<InventoryAccount | null> {
  if (!UUID_RE.test(accountId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("accounts").select(COLUMNS).eq("tenant_id", tenantId).eq("id", accountId).returns<Row[]>().maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;
  const names = await getIdentityNames(tenantId, data.identity_id ? [data.identity_id as string] : []);
  return toAccount(data, names, new Date(), dormantDays);
}

/**
 * Links an account to an identity by hand (a person's decision, kept by
 * later reconciliation runs) or unlinks it (identityId null → orphan). An
 * AI agent's accounts are managed from the agent, never re-pointed here:
 * moving one would silently change the agent's CAN.
 */
export async function linkAccount(tenantId: string, actorId: string, accountId: string, identityId: unknown): Promise<InventoryAccount> {
  const account = await getInventoryAccount(tenantId, accountId);
  if (!account) throw new ApiError(404, "NOT_FOUND", "No such account");
  if (account.agentId) throw new ApiError(409, "AGENT_ACCOUNT", "An AI agent's account is managed from the agent");
  let target: string | null = null;
  if (identityId !== null && identityId !== "" && identityId !== undefined) {
    if (typeof identityId !== "string" || !UUID_RE.test(identityId)) throw new ApiError(400, "VALIDATION_FAILED", "identityId: an identity id, or null to unlink");
    const identity = await getIdentity(tenantId, identityId);
    if (!identity) throw new ApiError(404, "NOT_FOUND", "identityId: that identity is not in this organization");
    if (identity.identityType === "AI_AGENT") throw new ApiError(400, "VALIDATION_FAILED", "identityId: an AI agent's accounts are added from the agent");
    if (identity.status !== "active") throw new ApiError(400, "VALIDATION_FAILED", "identityId: the identity is not active");
    target = identity.id;
  }
  if (target === account.identityId && (target ? account.correlation === "manual" : account.correlation === "orphan")) return account;
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("accounts")
    .update({ identity_id: target, correlation: target ? "manual" : "orphan", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", accountId)
    .eq("updated_at", account.updatedAt)
    .is("agent_id", null)
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data?.length) throw new ApiError(409, "CONFLICT", "The account changed meanwhile; reload and try again");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: target ? "account.linked" : "account.unlinked",
    objectType: "account",
    objectId: accountId,
    outcome: "success",
    metadata: { applicationId: account.applicationId, from: account.identityId, to: target, previousCorrelation: account.correlation },
  });
  return (await getInventoryAccount(tenantId, accountId))!;
}

export type ReconciliationRun = {
  id: string;
  applicationId: string;
  integrationId: string | null;
  status: "succeeded" | "failed";
  sourceAccounts: number;
  created: number;
  updated: number;
  correlated: number;
  orphan: number;
  ambiguous: number;
  missingIdentifier: number;
  notInSource: number;
  error: string | null;
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string | null;
};

function toRun(r: Record<string, unknown>): ReconciliationRun {
  return {
    id: r.id as string,
    applicationId: r.application_id as string,
    integrationId: (r.integration_id as string | null) ?? null,
    status: r.status as ReconciliationRun["status"],
    sourceAccounts: Number(r.source_accounts),
    created: Number(r.created),
    updated: Number(r.updated),
    correlated: Number(r.correlated),
    orphan: Number(r.orphan),
    ambiguous: Number(r.ambiguous),
    missingIdentifier: Number(r.missing_identifier),
    notInSource: Number(r.not_in_source),
    error: (r.error as string | null) ?? null,
    triggeredBy: (r.triggered_by as string | null) ?? null,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
  };
}

export async function listReconciliationRuns(tenantId: string, applicationId: string, limit = 10): Promise<ReconciliationRun[]> {
  if (!UUID_RE.test(applicationId)) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("account_reconciliation_runs")
    .select()
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .order("started_at", { ascending: false })
    .limit(Math.min(limit, 50));
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toRun);
}

type LiveConfig = { integrationId: string | null; accountIdentifierField: string | null; correlation: CorrelationRule };

/**
 * Reconciles an application's accounts with its connector, under the
 * configuration onboarding promoted — never a draft (§8.6). Reads the
 * connector's imported accounts (Integration's published contract),
 * correlates them to identities, writes the account inventory, marks
 * accounts the source no longer lists, and records the run. Nothing in
 * the connected system changes.
 */
export async function reconcileApplicationAccounts(tenantId: string, actorId: string, applicationId: string): Promise<ReconciliationRun> {
  if (!UUID_RE.test(applicationId)) throw new ApiError(404, "NOT_FOUND", "No such application");
  const supabase = await supabaseServer();
  const { data: onboarding, error: onbError } = await supabase
    .from("application_onboardings")
    .select("promoted_config, promoted_hash")
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .maybeSingle();
  if (onbError) throw new ApiError(500, "QUERY_FAILED", onbError.message);
  const { data: app } = await supabase.from("applications").select("id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (!app) throw new ApiError(404, "NOT_FOUND", "No such application");
  const config = onboarding?.promoted_config as LiveConfig | null;
  if (!config) throw new ApiError(409, "NOT_ONBOARDED", "Promote an onboarding configuration before reconciling accounts");
  if (!config.integrationId) throw new ApiError(409, "NOT_CONNECTED", "The live configuration has no connector to reconcile against");
  if (!config.accountIdentifierField) throw new ApiError(409, "NOT_CONFIGURED", "The live configuration names no account identifier");

  const startedAt = new Date();
  const admin = supabaseServiceRole();
  const record = async (fields: Record<string, unknown>) => {
    const { data, error } = await admin
      .from("account_reconciliation_runs")
      .insert({ tenant_id: tenantId, application_id: applicationId, integration_id: config.integrationId, config_hash: onboarding!.promoted_hash, triggered_by: actorId, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), ...fields })
      .select()
      .single();
    if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Could not record the run");
    return toRun(data);
  };

  try {
    const [objects, identities, existingRows] = await Promise.all([
      getNormalizedObjects(tenantId, config.integrationId, "account"),
      listIdentitiesForCorrelation(tenantId, NON_AGENT_TYPES),
      supabase
        .from("accounts")
        .select("id, external_account_ref, agent_id, identity_id, correlation, account_type, status, source, last_used_at")
        .eq("tenant_id", tenantId)
        .eq("application_id", applicationId)
        .limit(RECONCILE_CAP * 2),
    ]);
    if (existingRows.error) throw new ApiError(500, "QUERY_FAILED", existingRows.error.message);
    if (objects.length > RECONCILE_CAP) throw new ApiError(413, "TOO_MANY", `The connector imported ${objects.length} accounts; one run reconciles at most ${RECONCILE_CAP}`);
    const existing: ExistingAccount[] = (existingRows.data ?? []).map((r) => ({
      id: r.id,
      externalAccountRef: r.external_account_ref,
      agentId: r.agent_id,
      identityId: r.identity_id,
      correlation: r.correlation,
      accountType: r.account_type,
      status: r.status,
      source: r.source,
      lastUsedAt: r.last_used_at,
    }));
    const plan = planReconciliation({
      identifierField: config.accountIdentifierField,
      rule: config.correlation,
      sourceAccounts: objects.map((o) => ({ externalId: o.externalId, ...o.raw, normalized: o.normalized })),
      identities,
      existing,
      now: startedAt,
    });
    const nowIso = startedAt.toISOString();
    for (let i = 0; i < plan.upserts.length; i += 500) {
      const batch = plan.upserts.slice(i, i + 500).map((u) => ({
        ...u,
        tenant_id: tenantId,
        application_id: applicationId,
        source_integration_id: config.integrationId,
        missing_from_source_at: null,
        updated_at: nowIso,
      }));
      const { error } = await supabase.from("accounts").upsert(batch, { onConflict: "tenant_id,application_id,external_account_ref" });
      if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
    }
    for (let i = 0; i < plan.missingIds.length; i += 500) {
      const { error } = await supabase
        .from("accounts")
        .update({ missing_from_source_at: nowIso, updated_at: nowIso })
        .eq("tenant_id", tenantId)
        .in("id", plan.missingIds.slice(i, i + 500))
        .is("missing_from_source_at", null);
      if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
    }
    const c = plan.counts;
    const run = await record({
      status: "succeeded",
      source_accounts: c.sourceAccounts,
      created: c.created,
      updated: c.updated,
      correlated: c.correlated,
      orphan: c.orphan,
      ambiguous: c.ambiguous,
      missing_identifier: c.missingIdentifier,
      not_in_source: c.notInSource,
    });
    await writeAudit({ tenantId, actorId, actorType: "user", action: "account.reconciled", objectType: "application", objectId: applicationId, outcome: "success", metadata: { runId: run.id, ...c } });
    return run;
  } catch (err) {
    // Record the failure truthfully (§17.5), then report it.
    const message = err instanceof Error ? err.message : "Reconciliation failed";
    const run = await record({ status: "failed", error: message.slice(0, 1000) }).catch(() => null);
    await writeAudit({ tenantId, actorId, actorType: "user", action: "account.reconciled", objectType: "application", objectId: applicationId, outcome: "failure", metadata: { runId: run?.id ?? null, error: message.slice(0, 300) } });
    throw err;
  }
}
