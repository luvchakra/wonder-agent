/**
 * ACCESS-P0-17 — account inventory, pure (#9): which identity an imported
 * account belongs to, what a reconciliation run changes, and which
 * accounts are dormant. The service does the I/O.
 */

export const DORMANT_WINDOWS = [30, 60, 90, 180, 365] as const;
export const DEFAULT_DORMANT_DAYS = 90;
export const ACCOUNT_TYPES = ["standard", "privileged", "service", "shared"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type Correlation = "correlated" | "manual" | "orphan" | "ambiguous";

export function parseDormantDays(v: unknown): number {
  const n = Number(v);
  return (DORMANT_WINDOWS as readonly number[]).includes(n) ? n : DEFAULT_DORMANT_DAYS;
}

/** Not used within the window. Never used counts once the account is older than the window. */
export function isDormant(a: { lastUsedAt: string | null; createdAt: string }, now: Date, days: number): boolean {
  const cutoff = now.getTime() - days * 86_400_000;
  return new Date(a.lastUsedAt ?? a.createdAt).getTime() < cutoff;
}

/** The ISO cutoff a dormant query compares against. */
export function dormantCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function read(raw: Record<string, unknown>, path: string): unknown {
  if (path in raw) return raw[path];
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), raw);
}

const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

function firstDate(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = read(raw, k);
    if (v === undefined || v === null || v === "") continue;
    const d = new Date(String(v));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

const LAST_USED_KEYS = ["lastUsedAt", "lastLoginAt", "lastLogin", "last_login", "last_used_at", "lastLogonTimestamp"];
const NAME_KEYS = ["accountName", "username", "userName", "login", "name", "email"];

export type CorrelationRule = { accountField: string; identityField: "email" | "username" | "displayName" } | null;
export type CorrelationIdentity = { id: string; email: string | null; username: string | null; displayName: string };

/** The identities an account's value matches, case-insensitively. */
export function buildIndex(rule: CorrelationRule, identities: CorrelationIdentity[]): Map<string, string[]> {
  const byValue = new Map<string, string[]>();
  if (!rule) return byValue;
  for (const i of identities) {
    const v = text(i[rule.identityField]).toLowerCase();
    if (v) byValue.set(v, [...(byValue.get(v) ?? []), i.id]);
  }
  return byValue;
}

export function matchIdentity(rule: CorrelationRule, raw: Record<string, unknown>, index: Map<string, string[]>): { correlation: Correlation; identityId: string | null } {
  const key = rule ? text(read(raw, rule.accountField)).toLowerCase() : "";
  const matches = key ? (index.get(key) ?? []) : [];
  if (matches.length === 1) return { correlation: "correlated", identityId: matches[0] };
  if (matches.length > 1) return { correlation: "ambiguous", identityId: null };
  return { correlation: "orphan", identityId: null };
}

export type ExistingAccount = {
  id: string;
  externalAccountRef: string;
  agentId: string | null;
  identityId: string | null;
  correlation: Correlation;
  accountType: AccountType;
  status: "active" | "disabled";
  source: "manual" | "reconciliation";
  lastUsedAt: string | null;
};

export type AccountUpsert = {
  external_account_ref: string;
  account_name: string;
  agent_id: string | null;
  identity_id: string | null;
  correlation: Correlation;
  account_type: AccountType;
  status: "active" | "disabled";
  source: "manual" | "reconciliation";
  last_used_at: string | null;
  last_seen_at: string;
};

export type ReconciliationPlan = {
  upserts: AccountUpsert[];
  /** Accounts reconciliation imported earlier that the source no longer lists. */
  missingIds: string[];
  counts: { sourceAccounts: number; created: number; updated: number; correlated: number; orphan: number; ambiguous: number; missingIdentifier: number; notInSource: number };
};

/**
 * What a reconciliation run writes. For each imported account with the
 * configured identifier: an existing account keeps a person's manual link
 * and an agent's ownership (only its last-seen and last-used move); any
 * other account is correlated afresh. Accounts WonderID imported before
 * that the source no longer lists are counted, never deleted: the
 * connected system is the source of truth, and removal is a governed
 * action (#7, #15).
 */
export function planReconciliation(input: {
  identifierField: string;
  rule: CorrelationRule;
  sourceAccounts: Record<string, unknown>[];
  identities: CorrelationIdentity[];
  existing: ExistingAccount[];
  now: Date;
}): ReconciliationPlan {
  const index = buildIndex(input.rule, input.identities);
  const byRef = new Map(input.existing.map((a) => [a.externalAccountRef, a]));
  const seen = new Set<string>();
  const counts: ReconciliationPlan["counts"] = { sourceAccounts: input.sourceAccounts.length, created: 0, updated: 0, correlated: 0, orphan: 0, ambiguous: 0, missingIdentifier: 0, notInSource: 0 };
  const upserts: AccountUpsert[] = [];
  const nowIso = input.now.toISOString();

  for (const raw of input.sourceAccounts) {
    const ref = text(read(raw, input.identifierField));
    if (!ref) {
      counts.missingIdentifier++;
      continue;
    }
    if (seen.has(ref)) continue;
    seen.add(ref);
    const name = NAME_KEYS.map((k) => text(read(raw, k))).find(Boolean) ?? ref;
    const lastUsed = firstDate(raw, LAST_USED_KEYS);
    const disabled = ["disabled", "inactive", "suspended", "locked"].includes(text(read(raw, "status")).toLowerCase()) || read(raw, "enabled") === false;
    const privileged = read(raw, "privileged") === true || read(raw, "isPrivileged") === true || read(raw, "admin") === true;
    const current = byRef.get(ref);

    let identityId: string | null;
    let correlation: Correlation;
    if (current && (current.agentId || current.correlation === "manual")) {
      identityId = current.identityId;
      correlation = current.correlation;
    } else {
      ({ identityId, correlation } = matchIdentity(input.rule, raw, index));
    }
    if (correlation === "correlated" || correlation === "manual") counts.correlated++;
    else if (correlation === "ambiguous") counts.ambiguous++;
    else counts.orphan++;

    if (current) counts.updated++;
    else counts.created++;
    upserts.push({
      external_account_ref: ref,
      account_name: name.slice(0, 300),
      agent_id: current?.agentId ?? null,
      identity_id: identityId,
      correlation,
      account_type: current && current.accountType !== "standard" ? current.accountType : privileged ? "privileged" : "standard",
      status: disabled ? "disabled" : "active",
      source: current?.source ?? "reconciliation",
      // Never move last use backwards.
      last_used_at: [lastUsed, current?.lastUsedAt ?? null].filter(Boolean).sort().at(-1) ?? null,
      last_seen_at: nowIso,
    });
  }
  const missingIds = input.existing.filter((a) => a.source === "reconciliation" && !seen.has(a.externalAccountRef)).map((a) => a.id);
  counts.notInSource = missingIds.length;
  return { upserts, missingIds, counts };
}
