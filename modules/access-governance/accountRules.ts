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

/** A dormant window from a query value, else `fallback` (the organization's setting, Global Configuration). */
export function parseDormantDays(v: unknown, fallback: number = DEFAULT_DORMANT_DAYS): number {
  const n = Number(v);
  return (DORMANT_WINDOWS as readonly number[]).includes(n) ? n : fallback;
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

/**
 * The account a source record is, as reconciliation keys it: the value of
 * the promoted configuration's identifier field (ACCESS-P0-27 maps a
 * connector's grants to accounts with the same rule). Empty when missing.
 */
export function accountRefOf(raw: Record<string, unknown>, identifierField: string): string {
  return text(read(raw, identifierField));
}

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

/**
 * IDENTITY-P0-20: the kind of non-human identity an account stands for, from
 * the source's `accountType` (or `type`), or null for an ordinary account.
 * Only an account that matches no person becomes such an identity.
 */
const NON_HUMAN_WORDS: Record<string, "SERVICE_ACCOUNT" | "MACHINE" | "WORKLOAD" | "APPLICATION" | "API"> = {
  service: "SERVICE_ACCOUNT",
  service_account: "SERVICE_ACCOUNT",
  shared: "SERVICE_ACCOUNT",
  system: "SERVICE_ACCOUNT",
  technical: "SERVICE_ACCOUNT",
  machine: "MACHINE",
  device: "MACHINE",
  workload: "WORKLOAD",
  application: "APPLICATION",
  app: "APPLICATION",
  api: "API",
};
export function nonHumanTypeOf(raw: Record<string, unknown>): (typeof NON_HUMAN_WORDS)[string] | null {
  const word = text(read(raw, "accountType") ?? read(raw, "type") ?? read(raw, "normalized.accountType")).toLowerCase().replace(/[\s-]+/g, "_");
  return NON_HUMAN_WORDS[word] ?? null;
}

/** IDENTITY-P0-20: the source values an agent's declared identifier may appear in. */
const AGENT_ID_KEYS = ["clientId", "client_id", "appId", "applicationId", "servicePrincipalId", "objectId", "externalId"];

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
  counts: { sourceAccounts: number; created: number; updated: number; correlated: number; orphan: number; ambiguous: number; missingIdentifier: number; notInSource: number; relinkHeld: number };
  /**
   * WID-H01: accounts already linked to a person that would now match
   * someone else (a reassigned email, a reused username). The link is
   * kept; a person relinks by hand if the account really changed hands.
   */
  relinkHeld: { ref: string; keptIdentityId: string; matchedIdentityId: string | null; matched: Correlation }[];
  /** IDENTITY-P0-20: non-human accounts no person matches, for Identity to give each its own identity. */
  nonHumanAccounts: { ref: string; displayName: string; identityType: "SERVICE_ACCOUNT" | "MACHINE" | "WORKLOAD" | "APPLICATION" | "API"; ownerRef: string | null }[];
};

/**
 * What a reconciliation run writes. For each imported account with the
 * configured identifier: an existing account keeps a person's manual link
 * and an agent's ownership (only its last-seen and last-used move); an
 * account correlated to a person before keeps that person (WID-H01: a
 * different match is held, not applied); any other account is correlated
 * afresh. Accounts WonderID imported before
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
  /** IDENTITY-P0-20: identifiers declared on agents (agent_identities), to the agent. */
  agentIdentifiers?: Map<string, string>;
}): ReconciliationPlan {
  const index = buildIndex(input.rule, input.identities);
  const byRef = new Map(input.existing.map((a) => [a.externalAccountRef, a]));
  const seen = new Set<string>();
  const counts: ReconciliationPlan["counts"] = { sourceAccounts: input.sourceAccounts.length, created: 0, updated: 0, correlated: 0, orphan: 0, ambiguous: 0, missingIdentifier: 0, notInSource: 0, relinkHeld: 0 };
  const relinkHeld: ReconciliationPlan["relinkHeld"] = [];
  const upserts: AccountUpsert[] = [];
  const nonHumanAccounts: ReconciliationPlan["nonHumanAccounts"] = [];
  const nowIso = input.now.toISOString();

  for (const raw of input.sourceAccounts) {
    const ref = accountRefOf(raw, input.identifierField);
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
    let agentId = current?.agentId ?? null;
    // An agent's account: linked by an identifier the agent declares.
    const declared = !agentId ? [ref, ...AGENT_ID_KEYS.map((k) => text(read(raw, k)))].find((v) => v && input.agentIdentifiers?.has(v)) : undefined;
    if (declared) agentId = input.agentIdentifiers!.get(declared)!;
    if (current && (current.agentId || current.correlation === "manual")) {
      identityId = current.identityId;
      correlation = current.correlation;
    } else if (declared) {
      identityId = null;
      correlation = "correlated";
    } else {
      ({ identityId, correlation } = matchIdentity(input.rule, raw, index));
      // WID-H01: an account already linked to a person stays with them. A match elsewhere is held for a person, never moved.
      if (current?.identityId && current.correlation === "correlated" && identityId !== current.identityId) {
        relinkHeld.push({ ref, keptIdentityId: current.identityId, matchedIdentityId: identityId, matched: correlation });
        counts.relinkHeld++;
        identityId = current.identityId;
        correlation = "correlated";
      }
    }
    // A non-human account no person matches: its own governed identity (Identity creates or finds it).
    const nonHuman = correlation === "orphan" && !agentId ? nonHumanTypeOf(raw) : null;
    if (nonHuman) nonHumanAccounts.push({ ref, displayName: name.slice(0, 200), identityType: nonHuman, ownerRef: text(read(raw, "owner") ?? read(raw, "normalized.owner")) || null });
    if (correlation === "correlated" || correlation === "manual") counts.correlated++;
    else if (correlation === "ambiguous") counts.ambiguous++;
    else counts.orphan++;

    if (current) counts.updated++;
    else counts.created++;
    upserts.push({
      external_account_ref: ref,
      account_name: name.slice(0, 300),
      agent_id: agentId,
      identity_id: identityId,
      correlation,
      account_type: current && current.accountType !== "standard" ? current.accountType : privileged ? "privileged" : nonHuman ? (text(read(raw, "accountType") ?? read(raw, "normalized.accountType")).toLowerCase() === "shared" ? "shared" : "service") : "standard",
      status: disabled ? "disabled" : "active",
      source: current?.source ?? "reconciliation",
      // Never move last use backwards.
      last_used_at: [lastUsed, current?.lastUsedAt ?? null].filter(Boolean).sort().at(-1) ?? null,
      last_seen_at: nowIso,
    });
  }
  const missingIds = input.existing.filter((a) => a.source === "reconciliation" && !seen.has(a.externalAccountRef)).map((a) => a.id);
  counts.notInSource = missingIds.length;
  return { upserts, missingIds, counts, nonHumanAccounts, relinkHeld };
}
