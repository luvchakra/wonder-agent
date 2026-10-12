import { capabilitiesOf, specsOf, writeCapabilitiesOf } from "./engine";
import { DEFINITION_WRITE_OPERATIONS, RESOURCE_KINDS, type ConnectorDefinition, type ResourceKind } from "./types";
import { validateSettings } from "./validate";
import { RESOURCE_LABEL } from "./typeSummary";

/**
 * INTEGRATION-P0-21 part 4 — upgrading a connection to another version of
 * its connection type. Pure: what would change, and what stops the upgrade.
 * The service (connectionUpgrade.ts) applies a plan with no blockers.
 */

export type UpgradeArea = "settings" | "sign-in" | "reads" | "mapping" | "writes" | "receives";
export type UpgradeChange = { area: UpgradeArea; text: string };
export type UpgradePlan = {
  from: string;
  to: string;
  changes: UpgradeChange[];
  /** Reasons the upgrade cannot run; empty when it can. */
  blockers: string[];
  /** The connection's settings under the new version (kept, defaulted, or dropped). */
  settings: Record<string, string | number | boolean>;
  /** Whether changes in the system stay on (only those both versions support), or go off for new ones. */
  writes: "none" | "kept" | "turned_off";
};

/** -1, 0 or 1 for two x.y.z versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  return 0;
}

/** A copy of `o` without `key`. */
const without = (o: object, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const label = (k: ResourceKind) => RESOURCE_LABEL[k] ?? k;
const OPERATION: Record<string, string> = { revoke_access: "remove access", disable_account: "disable accounts", grant_access: "add access", create_account: "create accounts" };

/**
 * What upgrading from `from` to `to` changes for a connection with these
 * `settings`, whose stored credentials hold `secretKeys`, and whose writes
 * are on or off.
 */
export function planUpgrade(
  from: ConnectorDefinition,
  to: ConnectorDefinition,
  settings: Record<string, string | number | boolean>,
  secretKeys: string[],
  writesOn: boolean,
): UpgradePlan {
  const changes: UpgradeChange[] = [];
  const blockers: string[] = [];
  if (from.key !== to.key) blockers.push("That version belongs to another connection type.");
  if (from.version === to.version) blockers.push(`The connection already uses v${to.version}.`);
  if (from.driver !== to.driver) blockers.push(`The protocol changes from ${from.driver} to ${to.driver}: create a new connection instead.`);

  // Settings: kept where both versions have them, defaulted where new, dropped where gone.
  const fromKeys = new Set(from.settings.map((s) => s.key));
  const toKeys = new Set(to.settings.map((s) => s.key));
  const carried: Record<string, unknown> = {};
  for (const s of to.settings) {
    if (settings[s.key] !== undefined && fromKeys.has(s.key)) carried[s.key] = settings[s.key];
    else if (!fromKeys.has(s.key)) changes.push({ area: "settings", text: `New setting: ${s.label}${s.default !== undefined ? ` (${String(s.default)})` : ""}` });
  }
  for (const s of from.settings) if (!toKeys.has(s.key)) changes.push({ area: "settings", text: `No longer used: ${s.label}` });
  const { settings: next, issues } = validateSettings(to, carried);
  for (const i of issues) blockers.push(`Settings: ${i.message}`);

  // Sign-in: a different style is a new connection; a new required secret must be entered first.
  if (from.auth.type !== to.auth.type) {
    blockers.push(`Sign-in changes from ${from.auth.type} to ${to.auth.type}: create a new connection instead.`);
  } else if (to.auth.type !== "none" && from.auth.type !== "none") {
    const had = new Set(from.auth.fields.map((f) => f.key));
    for (const f of to.auth.fields) {
      if (had.has(f.key)) continue;
      if (!f.optional && !secretKeys.includes(f.key)) blockers.push(`Sign-in needs a new value, ${f.label}, that this connection does not have.`);
      else changes.push({ area: "sign-in", text: `New credential: ${f.label}` });
    }
    const keep = new Set(to.auth.fields.map((f) => f.key));
    for (const f of from.auth.fields) if (!keep.has(f.key)) changes.push({ area: "sign-in", text: `No longer used: ${f.label}` });
    if (!same(without(from.auth, "fields"), without(to.auth, "fields"))) changes.push({ area: "sign-in", text: "How it signs in changes (addresses or options)" });
  }

  // Reads and their mappings, per kind.
  for (const kind of RESOURCE_KINDS) {
    const a = specsOf(from, kind);
    const b = specsOf(to, kind);
    if (!a.length && !b.length) continue;
    if (!a.length) {
      changes.push({ area: "reads", text: `Starts reading ${label(kind)}` });
      continue;
    }
    if (!b.length) {
      changes.push({ area: "reads", text: `Stops reading ${label(kind)}` });
      continue;
    }
    const strip = (specs: typeof a) => specs.map((spec) => without(spec, "fields"));
    if (!same(strip(a), strip(b))) changes.push({ area: "reads", text: `${label(kind)}: read differently (requests, paging or filters)` });
    const fa = Object.assign({}, ...a.map((s) => s.fields)) as Record<string, unknown>;
    const fb = Object.assign({}, ...b.map((s) => s.fields)) as Record<string, unknown>;
    for (const f of Object.keys(fb)) {
      if (!(f in fa)) changes.push({ area: "mapping", text: `${label(kind)}: new field ${f}` });
      else if (!same(fa[f], fb[f])) changes.push({ area: "mapping", text: `${label(kind)}: ${f} is mapped differently` });
    }
    for (const f of Object.keys(fa)) if (!(f in fb)) changes.push({ area: "mapping", text: `${label(kind)}: field ${f} is no longer filled` });
  }

  // Changes in the system: never widened by an upgrade.
  const opsFrom = DEFINITION_WRITE_OPERATIONS.filter((op) => from.write?.[op]);
  const opsTo = DEFINITION_WRITE_OPERATIONS.filter((op) => to.write?.[op]);
  const added = opsTo.filter((op) => !opsFrom.includes(op));
  for (const op of added) changes.push({ area: "writes", text: `Can now ${OPERATION[op]}` });
  for (const op of opsFrom.filter((o) => !opsTo.includes(o))) changes.push({ area: "writes", text: `Can no longer ${OPERATION[op]}` });
  for (const op of opsFrom.filter((o) => opsTo.includes(o))) if (!same(from.write?.[op], to.write?.[op])) changes.push({ area: "writes", text: `Makes "${OPERATION[op]}" differently` });
  const writes: UpgradePlan["writes"] = !writesOn ? "none" : added.length || !opsTo.length ? "turned_off" : "kept";
  if (writes === "turned_off") changes.push({ area: "writes", text: "Changes in the system turn off; turn them on again to allow what this version makes" });

  // Receiving channels.
  for (const ch of ["runtimeEvents", "webhook", "file", "gateway"] as const) {
    const a = Boolean(from.receive?.[ch]);
    const b = Boolean(to.receive?.[ch]);
    if (a !== b) changes.push({ area: "receives", text: `${b ? "Starts" : "Stops"} receiving ${ch === "runtimeEvents" ? "runtime events" : ch}` });
  }

  return { from: from.version, to: to.version, changes, blockers, settings: next, writes };
}

/** The capabilities a connection declares after an upgrade: never more writes than before. */
export function upgradedCapabilities(to: ConnectorDefinition, plan: UpgradePlan) {
  const supported = writeCapabilitiesOf(to);
  const on = plan.writes === "kept";
  // Every write key is set, so nothing declared by the old version survives.
  const writes = Object.fromEntries(Object.entries(supported).map(([k, v]) => [k, on && v === true]));
  return { ...capabilitiesOf(to), ...writes };
}
