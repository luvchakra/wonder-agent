/**
 * ACCESS-P0-27 — pure rules (#9) for reconciling an onboarded application's
 * entitlements and access with what its connector imported. The service
 * (connectorAccess.ts) loads the staged records and the current rows, and
 * writes the plan.
 *
 * - An entitlement is the connector's when it carries the connection and
 *   its id there (`external_ref`). One entered by hand or by file with the
 *   same name and no id is adopted the first time (it gains the id).
 * - A grant names its account by the connector's account id, which the
 *   promoted identifier field turns into the account's key, and its
 *   entitlement by the connector's entitlement id.
 * - Nothing is deleted or revoked. In a full run, what the connector
 *   brought before and no longer lists is marked missing from the source;
 *   anything listed again is restored. An incremental run only adds,
 *   updates and restores.
 * - Access WonderID holds from elsewhere (a request, an administrator) for
 *   the same account and entitlement counts as present: no duplicate.
 * - ACCESS-P0-28: a requested grant waiting for fulfilment (or fulfilled
 *   but not yet verified) that the source now lists is verified.
 */

export type ReconcileMode = "full" | "incremental";

export type StagedEntitlement = { externalId: string; values: Record<string, unknown> };
export type StagedGrant = { externalId: string; values: Record<string, unknown> };

export type ExistingEntitlement = {
  id: string;
  name: string;
  privilegeLevel: string;
  dataClassification: string | null;
  sourceIntegrationId: string | null;
  externalRef: string | null;
  missingFromSourceAt: string | null;
};

export type ExistingGrant = {
  id: string;
  accountId: string;
  entitlementId: string;
  grantType: string;
  sourceIntegrationId: string | null;
  missingFromSourceAt: string | null;
  /** ACCESS-P0-28: `none` for recorded access; a requested grant's progress otherwise. */
  fulfilmentStatus?: string;
};

export type FieldChange = { field: string; from: string | null; to: string | null };

export type EntitlementPlan = {
  creates: { ref: string; name: string; privilegeLevel: string; dataClassification: string | null }[];
  updates: { id: string; ref: string; name: string; changes: FieldChange[]; set: Record<string, unknown> }[];
  removed: { id: string; ref: string; name: string }[];
  restored: { id: string; ref: string; name: string }[];
  unchanged: number;
  invalid: { ref: string; reason: string }[];
  /** Connector entitlement id → WonderID id, or `new:<ref>` for one this plan creates. */
  byRef: Map<string, string>;
};

export type GrantPlan = {
  creates: { ref: string; accountId: string; entitlementId: string; grantType: string }[];
  removed: { id: string; accountId: string; entitlementId: string }[];
  restored: { id: string; accountId: string; entitlementId: string }[];
  /** ACCESS-P0-28: requested grants the source now lists. */
  verified: { id: string; accountId: string; entitlementId: string }[];
  unchanged: number;
  unresolved: { ref: string; reason: string }[];
};

const PRIVILEGE_LEVELS = ["standard", "elevated", "admin"];
export const GRANT_TYPES = [
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

const text = (v: unknown, max = 500): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const lower = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Whether a staged entitlement belongs to this application: no application named, or this one by id or name. */
export function belongsToApplication(values: Record<string, unknown>, app: { id: string; name: string }): boolean {
  const named = text(values.application, 300);
  return !named || named.toLowerCase() === app.id.toLowerCase() || lower(named) === lower(app.name);
}

export function planEntitlements(input: {
  integrationId: string;
  mode: ReconcileMode;
  staged: StagedEntitlement[];
  existing: ExistingEntitlement[];
}): EntitlementPlan {
  const plan: EntitlementPlan = { creates: [], updates: [], removed: [], restored: [], unchanged: 0, invalid: [], byRef: new Map() };
  const ours = new Map(input.existing.filter((e) => e.sourceIntegrationId === input.integrationId && e.externalRef).map((e) => [e.externalRef!, e]));
  // Adoptable: no connector id yet; adopted only when the name is unique in the application.
  const unclaimedByName = new Map<string, ExistingEntitlement[]>();
  for (const e of input.existing) {
    if (e.externalRef) continue;
    const k = lower(e.name);
    unclaimedByName.set(k, [...(unclaimedByName.get(k) ?? []), e]);
  }
  const seen = new Set<string>();
  const adopted = new Set<string>();

  for (const s of input.staged) {
    const ref = text(s.externalId);
    if (!ref) continue;
    if (seen.has(ref)) {
      plan.invalid.push({ ref, reason: "listed twice by the source" });
      continue;
    }
    seen.add(ref);
    const name = text(s.values.name, 300);
    if (!name) {
      plan.invalid.push({ ref, reason: "no name" });
      continue;
    }
    const privilegeRaw = lower(text(s.values.privilegeLevel, 40));
    const privilege = PRIVILEGE_LEVELS.includes(privilegeRaw) ? privilegeRaw : null;
    const classification = text(s.values.dataClassification, 100);

    let current = ours.get(ref);
    let adopt = false;
    if (!current) {
      const candidates = (unclaimedByName.get(lower(name)) ?? []).filter((e) => !adopted.has(e.id));
      if (candidates.length === 1) {
        current = candidates[0];
        adopt = true;
        adopted.add(current.id);
      } else if (candidates.length > 1) {
        plan.invalid.push({ ref, reason: `${candidates.length} entitlements of this application are named "${name.slice(0, 80)}"` });
        continue;
      }
    }
    if (!current) {
      plan.creates.push({ ref, name, privilegeLevel: privilege ?? "standard", dataClassification: classification });
      plan.byRef.set(ref, `new:${ref}`);
      continue;
    }
    plan.byRef.set(ref, current.id);
    const changes: FieldChange[] = [];
    const set: Record<string, unknown> = {};
    if (adopt) {
      changes.push({ field: "connector id", from: null, to: ref });
      set.source_integration_id = input.integrationId;
      set.external_ref = ref;
    }
    if (name !== current.name) {
      changes.push({ field: "name", from: current.name, to: name });
      set.name = name;
    }
    if (privilege && privilege !== current.privilegeLevel) {
      changes.push({ field: "privilegeLevel", from: current.privilegeLevel, to: privilege });
      set.privilege_level = privilege;
    }
    if (classification && classification !== current.dataClassification) {
      changes.push({ field: "dataClassification", from: current.dataClassification, to: classification });
      set.data_classification = classification;
    }
    if (current.missingFromSourceAt) plan.restored.push({ id: current.id, ref, name });
    if (changes.length) plan.updates.push({ id: current.id, ref, name, changes, set });
    else if (!current.missingFromSourceAt) plan.unchanged++;
  }

  if (input.mode === "full") {
    for (const [ref, e] of ours) {
      if (!seen.has(ref) && !e.missingFromSourceAt) plan.removed.push({ id: e.id, ref, name: e.name });
    }
  }
  return plan;
}

export function planGrants(input: {
  integrationId: string;
  mode: ReconcileMode;
  staged: StagedGrant[];
  /** Connector account id → the application's account id. */
  accountByRef: Map<string, string>;
  /** Connector entitlement id → WonderID entitlement id (or `new:<ref>`). */
  entitlementByRef: Map<string, string>;
  /** Live (not revoked) grants of the application's accounts. */
  existing: ExistingGrant[];
}): GrantPlan {
  const plan: GrantPlan = { creates: [], removed: [], restored: [], verified: [], unchanged: 0, unresolved: [] };
  const live = new Map<string, ExistingGrant[]>();
  for (const g of input.existing) {
    const k = `${g.accountId}|${g.entitlementId}`;
    live.set(k, [...(live.get(k) ?? []), g]);
  }
  const seen = new Set<string>();

  for (const s of input.staged) {
    const ref = text(s.externalId) ?? "";
    const accountRef = text(s.values.accountExternalId) ?? "";
    const entRef = text(s.values.entitlementExternalId) ?? "";
    const accountId = input.accountByRef.get(accountRef);
    const entitlementId = input.entitlementByRef.get(entRef);
    if (!accountId) {
      plan.unresolved.push({ ref, reason: `no account "${accountRef.slice(0, 80)}" (reconcile accounts first)` });
      continue;
    }
    if (!entitlementId) {
      plan.unresolved.push({ ref, reason: `no entitlement "${entRef.slice(0, 80)}" from this connection` });
      continue;
    }
    const key = `${accountId}|${entitlementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const grantType = lower(text(s.values.grantType, 40)) || "direct";
    const current = live.get(key) ?? [];
    if (!current.length) {
      plan.creates.push({ ref, accountId, entitlementId, grantType: GRANT_TYPES.includes(grantType) ? grantType : "direct" });
      continue;
    }
    const missing = current.filter((g) => g.missingFromSourceAt);
    for (const g of missing) plan.restored.push({ id: g.id, accountId, entitlementId });
    const unverified = current.filter((g) => g.fulfilmentStatus === "pending_fulfilment" || g.fulfilmentStatus === "fulfilled_unverified");
    for (const g of unverified) plan.verified.push({ id: g.id, accountId, entitlementId });
    if (!missing.length && !unverified.length) plan.unchanged++;
  }

  if (input.mode === "full") {
    for (const g of input.existing) {
      if (g.sourceIntegrationId !== input.integrationId || g.missingFromSourceAt) continue;
      if (!seen.has(`${g.accountId}|${g.entitlementId}`)) plan.removed.push({ id: g.id, accountId: g.accountId, entitlementId: g.entitlementId });
    }
  }
  return plan;
}

export type AccessCounts = {
  entitlements: { added: number; changed: number; removed: number; restored: number; unchanged: number; invalid: number };
  grants: { added: number; removed: number; restored: number; verified: number; unchanged: number; unresolved: number };
};

export function countsOf(ents: EntitlementPlan, grants: GrantPlan): AccessCounts {
  return {
    entitlements: { added: ents.creates.length, changed: ents.updates.length, removed: ents.removed.length, restored: ents.restored.length, unchanged: ents.unchanged, invalid: ents.invalid.length },
    grants: {
      added: grants.creates.length,
      removed: grants.removed.length,
      restored: grants.restored.length,
      verified: grants.verified.length,
      unchanged: grants.unchanged,
      unresolved: grants.unresolved.length,
    },
  };
}

/**
 * A canonical description of what the plan would write, independent of
 * order; the service hashes it so an apply can prove it matches its
 * preview.
 */
export function planFingerprint(ents: EntitlementPlan, grants: GrantPlan): string {
  const sorted = (xs: string[]) => [...xs].sort();
  return JSON.stringify({
    ec: sorted(ents.creates.map((c) => `${c.ref}|${c.name}|${c.privilegeLevel}|${c.dataClassification ?? ""}`)),
    eu: sorted(ents.updates.map((u) => `${u.id}|${JSON.stringify(Object.entries(u.set).sort())}`)),
    er: sorted(ents.removed.map((r) => r.id)),
    es: sorted(ents.restored.map((r) => r.id)),
    gc: sorted(grants.creates.map((c) => `${c.accountId}|${c.entitlementId}|${c.grantType}`)),
    gr: sorted(grants.removed.map((r) => r.id)),
    gs: sorted(grants.restored.map((r) => r.id)),
    gv: sorted(grants.verified.map((r) => r.id)),
  });
}
