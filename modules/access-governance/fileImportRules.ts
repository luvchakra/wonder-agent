import type { GrantType, PrivilegeLevel } from "@/lib/shared/types/access-governance";
import type { ImportFieldChange, ImportPlanRow, ImportRecord } from "@/lib/shared/types/integrations";
import { ACCOUNT_TYPES } from "./accountRules";

/**
 * Pure rules (#9) for importing applications, entitlements, accounts and
 * access from a CSV on their object pages (2026-10-10, user decision):
 * which existing record each row is, and what would change. Additive only:
 * a row adds a record or updates one; nothing missing from the file is
 * removed, revoked or deactivated. The service (fileImport.ts) reads the
 * lookups and writes the plan.
 */

export const ACCESS_IMPORT_KINDS = ["application", "entitlement", "account", "access_grant"] as const;
export type AccessImportKind = (typeof ACCESS_IMPORT_KINDS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVILEGE_LEVELS: readonly PrivilegeLevel[] = ["standard", "elevated", "admin"];
const GRANT_TYPES: readonly GrantType[] = [
  "direct",
  "inherited",
  "group",
  "role",
  "delegated",
  "token_scope",
  "oauth_scope",
  "api_scope",
  "mcp_tool_permission",
  "service_account_relationship",
];
const ACCOUNT_STATUS_WORDS: Record<string, "active" | "disabled"> = {
  active: "active",
  enabled: "active",
  true: "active",
  "1": "active",
  disabled: "disabled",
  inactive: "disabled",
  suspended: "disabled",
  locked: "disabled",
  false: "disabled",
  "0": "disabled",
};

export type AppRef = { id: string; name: string; category: string | null; description: string | null };
export type EntitlementRef = { id: string; applicationId: string; name: string; privilegeLevel: string; dataClassification: string | null };
export type AccountRef = {
  id: string;
  applicationId: string;
  externalAccountRef: string;
  accountName: string | null;
  status: string;
  accountType: string;
  lastUsedAt: string | null;
  identityId: string | null;
  agentId: string | null;
};
export type GrantRef = { accountId: string; entitlementId: string; grantType: string };
export type OwnerRef = { id: string; email: string | null; username: string | null; sourceNativeId: string | null };

export type AccessLookups = {
  applications: AppRef[];
  entitlements?: EntitlementRef[];
  accounts?: AccountRef[];
  grants?: GrantRef[];
  owners?: OwnerRef[];
};

/** A row's plan plus what to write: `insert`/`update` are column values of the kind's table. */
export type AccessPlanRow = ImportPlanRow & { insert?: Record<string, unknown>; update?: Record<string, unknown> };

const text = (v: unknown, max = 300): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const lower = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

function group<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

const base = (r: ImportRecord): Pick<ImportPlanRow, "row" | "externalId"> => ({ row: r.row, externalId: r.externalId });
const invalid = (r: ImportRecord, note: string): AccessPlanRow => ({ ...base(r), decision: "invalid", targetId: null, changes: [], note });
const review = (r: ImportRecord, note: string): AccessPlanRow => ({ ...base(r), decision: "review", targetId: null, changes: [], note });

/** Field changes for the given values; a value the file leaves empty changes nothing. */
function diff(current: Record<string, string | null>, incoming: Record<string, string | null>): ImportFieldChange[] {
  const changes: ImportFieldChange[] = [];
  for (const [field, to] of Object.entries(incoming)) {
    if (to === null) continue;
    const from = current[field] ?? null;
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

function updated(r: ImportRecord, targetId: string, changes: ImportFieldChange[], update: Record<string, unknown>, note: string | null = null): AccessPlanRow {
  return changes.length
    ? { ...base(r), decision: "update", targetId, changes, note, update }
    : { ...base(r), decision: "unchanged", targetId, changes: [], note };
}

function applicationResolver(apps: AppRef[]) {
  const byId = new Map(apps.map((a) => [a.id, a]));
  const byName = group(apps, (a) => lower(a.name));
  return (ref: unknown): { app: AppRef } | { error: string } => {
    const value = text(ref, 200);
    if (!value) return { error: "no application (add an application column)" };
    if (UUID_RE.test(value) && byId.has(value.toLowerCase())) return { app: byId.get(value.toLowerCase())! };
    const named = byName.get(lower(value));
    if (named?.length === 1) return { app: named[0] };
    return { error: `no application named "${value.slice(0, 80)}" (import it on Applications first)` };
  };
}

// ---------------------------------------------------------------- applications

export function planApplications(records: ImportRecord[], lookups: AccessLookups): AccessPlanRow[] {
  const byId = new Map(lookups.applications.map((a) => [a.id, a]));
  const byName = new Map(lookups.applications.map((a) => [lower(a.name), a]));
  const claimed = new Map<string, number | null>();
  return records.map((r) => {
    const name = text(r.values.name, 200);
    const incoming = { name, category: text(r.values.category, 100), description: text(r.values.description, 2000) };
    if (!name) return invalid(r, "no name");
    const byIdMatch = UUID_RE.test(r.externalId) ? byId.get(r.externalId.toLowerCase()) : undefined;
    const app = byIdMatch ?? byName.get(lower(name));
    if (app && claimed.has(app.id)) return review(r, `the same application as row ${claimed.get(app.id) ?? "above"}`);
    if (!app) {
      if (claimed.has(`name:${lower(name)}`)) return review(r, `the same application as row ${claimed.get(`name:${lower(name)}`) ?? "above"}`);
      claimed.set(`name:${lower(name)}`, r.row);
      return { ...base(r), decision: "new", targetId: null, changes: diff({}, incoming), note: null, insert: { name, category: incoming.category, description: incoming.description } };
    }
    claimed.set(app.id, r.row);
    // A rename only when the row names the application by its id.
    const renamed = byIdMatch && name !== app.name ? name : null;
    if (renamed) {
      const other = byName.get(lower(renamed));
      if (other && other.id !== app.id) return invalid(r, `another application is named "${renamed}"`);
    }
    const changes = diff({ name: app.name, category: app.category, description: app.description }, { name: renamed, category: incoming.category, description: incoming.description });
    const update: Record<string, unknown> = {};
    for (const c of changes) update[c.field] = c.to;
    return updated(r, app.id, changes, update);
  });
}

// ---------------------------------------------------------------- entitlements

export function planEntitlements(records: ImportRecord[], lookups: AccessLookups): AccessPlanRow[] {
  const resolveApp = applicationResolver(lookups.applications);
  const ents = lookups.entitlements ?? [];
  const byId = new Map(ents.map((e) => [e.id, e]));
  const byAppName = group(ents, (e) => `${e.applicationId}|${lower(e.name)}`);
  const claimed = new Map<string, number | null>();
  return records.map((r) => {
    const name = text(r.values.name, 300);
    if (!name) return invalid(r, "no name");
    const privilege = text(r.values.privilegeLevel, 40)?.toLowerCase() ?? null;
    if (privilege && !(PRIVILEGE_LEVELS as readonly string[]).includes(privilege)) return invalid(r, `privilegeLevel "${privilege}" is not one of ${PRIVILEGE_LEVELS.join(", ")}`);
    const classification = text(r.values.dataClassification, 100);

    let ent = UUID_RE.test(r.externalId) ? byId.get(r.externalId.toLowerCase()) : undefined;
    let appId = ent?.applicationId ?? null;
    if (!ent) {
      const resolved = resolveApp(r.values.application);
      if ("error" in resolved) return invalid(r, resolved.error);
      appId = resolved.app.id;
      const matches = byAppName.get(`${appId}|${lower(name)}`) ?? [];
      if (matches.length > 1) return review(r, `${matches.length} entitlements of this application have this name`);
      ent = matches[0];
    }
    const key = ent ? ent.id : `new:${appId}|${lower(name)}`;
    if (claimed.has(key)) return review(r, `the same entitlement as row ${claimed.get(key) ?? "above"}`);
    claimed.set(key, r.row);
    if (!ent) {
      return {
        ...base(r),
        decision: "new",
        targetId: null,
        changes: diff({}, { name, privilegeLevel: privilege ?? "standard", dataClassification: classification }),
        note: null,
        insert: { application_id: appId, name, privilege_level: privilege ?? "standard", data_classification: classification },
      };
    }
    const renamed = UUID_RE.test(r.externalId) && name !== ent.name ? name : null;
    const changes = diff({ name: ent.name, privilegeLevel: ent.privilegeLevel, dataClassification: ent.dataClassification }, { name: renamed, privilegeLevel: privilege, dataClassification: classification });
    const column: Record<string, string> = { name: "name", privilegeLevel: "privilege_level", dataClassification: "data_classification" };
    const update: Record<string, unknown> = {};
    for (const c of changes) update[column[c.field]] = c.to;
    return updated(r, ent.id, changes, update);
  });
}

// ---------------------------------------------------------------- accounts

function ownerResolver(owners: OwnerRef[]) {
  const byId = new Set(owners.map((o) => o.id));
  const byNative = group(owners, (o) => (o.sourceNativeId ?? "").trim());
  const byEmail = group(owners, (o) => lower(o.email));
  const byUsername = group(owners, (o) => lower(o.username));
  return (ref: string): { id: string } | { note: string } => {
    if (UUID_RE.test(ref) && byId.has(ref.toLowerCase())) return { id: ref.toLowerCase() };
    for (const [by, list] of [
      ["external id", byNative.get(ref)],
      ["email", byEmail.get(lower(ref))],
      ["username", byUsername.get(lower(ref))],
    ] as const) {
      if (!list?.length) continue;
      if (list.length > 1) return { note: `owner "${ref.slice(0, 80)}" matches ${list.length} identities by ${by}; left unlinked` };
      return { id: list[0].id };
    }
    return { note: `no identity "${ref.slice(0, 80)}"; left unlinked` };
  };
}

function timestamp(v: unknown): string | null | { error: string } {
  const s = text(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return { error: `"${s}" is not a date` };
  return new Date(t).toISOString();
}

export function planAccounts(records: ImportRecord[], lookups: AccessLookups, origin: { integrationId: string }): AccessPlanRow[] {
  const resolveApp = applicationResolver(lookups.applications);
  const resolveOwner = ownerResolver(lookups.owners ?? []);
  const accounts = lookups.accounts ?? [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byRef = new Map(accounts.map((a) => [`${a.applicationId}|${a.externalAccountRef}`, a]));
  const claimed = new Map<string, number | null>();
  return records.map((r) => {
    const statusWord = text(r.values.status, 40)?.toLowerCase() ?? null;
    const status = statusWord ? ACCOUNT_STATUS_WORDS[statusWord] : null;
    if (statusWord && !status) return invalid(r, `status "${statusWord}" is not active or disabled`);
    let accountType = text(r.values.accountType, 40)?.toLowerCase() ?? null;
    if (accountType && !(ACCOUNT_TYPES as readonly string[]).includes(accountType)) return invalid(r, `accountType "${accountType}" is not one of ${ACCOUNT_TYPES.join(", ")}`);
    if (!accountType && r.values.privileged === true) accountType = "privileged";
    const lastUsed = timestamp(r.values.lastLoginAt);
    if (lastUsed && typeof lastUsed === "object") return invalid(r, `lastLoginAt: ${lastUsed.error}`);
    const accountName = text(r.values.username, 300) ?? text(r.values.displayName, 300);

    let account = UUID_RE.test(r.externalId) ? byId.get(r.externalId.toLowerCase()) : undefined;
    let appId = account?.applicationId ?? null;
    if (!account) {
      const resolved = resolveApp(r.values.application);
      if ("error" in resolved) return invalid(r, resolved.error);
      appId = resolved.app.id;
      account = byRef.get(`${appId}|${r.externalId}`);
    }
    const key = account ? account.id : `new:${appId}|${r.externalId}`;
    if (claimed.has(key)) return review(r, `the same account as row ${claimed.get(key) ?? "above"}`);
    claimed.set(key, r.row);

    const ownerRef = text(r.values.owner, 300);
    const owner = ownerRef ? resolveOwner(ownerRef) : null;
    const ownerNote = owner && "note" in owner ? owner.note : null;
    const ownerId = owner && "id" in owner ? owner.id : null;

    if (!account) {
      return {
        ...base(r),
        decision: "new",
        targetId: null,
        changes: diff({}, { username: accountName, status: status ?? "active", accountType: accountType ?? "standard", lastLoginAt: lastUsed, owner: ownerId ? ownerRef : null }),
        note: ownerNote,
        insert: {
          application_id: appId,
          external_account_ref: r.externalId,
          account_name: accountName,
          status: status ?? "active",
          account_type: accountType ?? "standard",
          last_used_at: lastUsed,
          identity_id: ownerId,
          correlation: ownerId ? "manual" : "orphan",
          source: "manual",
          source_integration_id: origin.integrationId,
        },
      };
    }
    const changes = diff(
      { username: account.accountName, status: account.status, accountType: account.accountType, lastLoginAt: account.lastUsedAt ? new Date(account.lastUsedAt).toISOString() : null },
      { username: accountName, status, accountType, lastLoginAt: lastUsed },
    );
    const column: Record<string, string> = { username: "account_name", status: "status", accountType: "account_type", lastLoginAt: "last_used_at" };
    const update: Record<string, unknown> = {};
    for (const c of changes) update[column[c.field]] = c.to;
    let note = ownerNote;
    // An owner fills an unlinked account; an account already linked keeps its owner (linking it elsewhere is a decision on the account's page).
    if (ownerId && !account.identityId && !account.agentId) {
      changes.push({ field: "owner", from: null, to: ownerRef });
      update.identity_id = ownerId;
      update.correlation = "manual";
    } else if (ownerId && account.identityId && ownerId !== account.identityId) {
      note = "already linked to another owner; kept";
    }
    return updated(r, account.id, changes, update, note);
  });
}

// ---------------------------------------------------------------- access grants

/**
 * Access a file reports is what the target system holds: it is recorded
 * for any account (a person's, an agent's, any identity's) with the file's
 * connection as its source, never as a grant someone made. The access
 * ledger (ACCESS-P0-24) then looks for the WonderID approval behind it and
 * marks it unproven when there is none (owner decision, 2026-10-10).
 */
export function planGrants(records: ImportRecord[], lookups: AccessLookups, origin: { integrationId: string } = { integrationId: "" }): AccessPlanRow[] {
  const accounts = lookups.accounts ?? [];
  const ents = lookups.entitlements ?? [];
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const accountsByRef = group(accounts, (a) => a.externalAccountRef);
  const entsById = new Map(ents.map((e) => [e.id, e]));
  const entsByName = group(ents, (e) => lower(e.name));
  const active = new Map((lookups.grants ?? []).map((g) => [`${g.accountId}|${g.entitlementId}`, g]));
  const claimed = new Map<string, number | null>();
  return records.map((r) => {
    const accountRef = text(r.values.accountExternalId, 300) ?? "";
    const entRef = text(r.values.entitlementExternalId, 300) ?? "";
    const accountMatches = UUID_RE.test(accountRef) && accountsById.has(accountRef.toLowerCase()) ? [accountsById.get(accountRef.toLowerCase())!] : (accountsByRef.get(accountRef) ?? []);
    if (accountMatches.length === 0) return invalid(r, `no account "${accountRef.slice(0, 80)}" (import it on Accounts first)`);
    if (accountMatches.length > 1) return review(r, `${accountMatches.length} accounts have the id "${accountRef.slice(0, 80)}"; use the account's WonderID id`);
    const account = accountMatches[0];
    // An account holds entitlements of its own application only.
    const entMatches = (UUID_RE.test(entRef) && entsById.has(entRef.toLowerCase()) ? [entsById.get(entRef.toLowerCase())!] : (entsByName.get(lower(entRef)) ?? [])).filter(
      (e) => e.applicationId === account.applicationId,
    );
    if (entMatches.length === 0) return invalid(r, `no entitlement "${entRef.slice(0, 80)}" in the account's application (import it on Entitlements first)`);
    if (entMatches.length > 1) return review(r, `${entMatches.length} entitlements are named "${entRef.slice(0, 80)}"; use the entitlement's WonderID id`);
    const ent = entMatches[0];
    const grantType = text(r.values.grantType, 40)?.toLowerCase() ?? "direct";
    if (!(GRANT_TYPES as readonly string[]).includes(grantType)) return invalid(r, `grantType "${grantType}" is not one of ${GRANT_TYPES.join(", ")}`);

    const key = `${account.id}|${ent.id}`;
    if (claimed.has(key)) return review(r, `the same access as row ${claimed.get(key) ?? "above"}`);
    claimed.set(key, r.row);
    const existing = active.get(key);
    if (existing) {
      return { ...base(r), decision: "unchanged", targetId: null, changes: [], note: existing.grantType !== grantType ? `already granted as ${existing.grantType}; kept` : null };
    }
    return {
      ...base(r),
      decision: "new",
      targetId: null,
      changes: diff({}, { account: accountRef, entitlement: ent.name, grantType }),
      note: null,
      insert: { account_id: account.id, entitlement_id: ent.id, grant_type: grantType, source_integration_id: origin.integrationId || null },
    };
  });
}

export function planAccessImport(kind: AccessImportKind, records: ImportRecord[], lookups: AccessLookups, origin: { integrationId: string }): AccessPlanRow[] {
  if (kind === "application") return planApplications(records, lookups);
  if (kind === "entitlement") return planEntitlements(records, lookups);
  if (kind === "account") return planAccounts(records, lookups, origin);
  return planGrants(records, lookups, origin);
}
