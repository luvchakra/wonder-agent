/**
 * ACCESS-P0-35 (owner decision, 17 Oct 2026): policy changes, separation of
 * duties rules included, are versioned with what changed, and apply at once
 * without a second administrator. Pure: what changed between two of a
 * policy's states, in words. A state recorded before rules were kept in
 * versions has no `rules`; then rule changes are not claimed (§19.2).
 */

export type PolicyState = Record<string, unknown> & { rules?: { ruleType: string; condition: unknown }[] };

const FIELDS: [string, string][] = [
  ["name", "Name"],
  ["description", "Description"],
  ["severity", "Severity"],
  ["action", "Action"],
  ["status", "Status"],
  ["priority", "Priority"],
  ["exceptionProcess", "Exception process"],
  ["ownerId", "Owner"],
  ["expiryDate", "Expiry date"],
  ["scope", "Scope"],
];

const shown = (v: unknown) => (v === null || v === undefined || v === "" ? "none" : typeof v === "object" ? "changed" : String(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A rule in a few words: an SoD rule names its conflicting actions. */
export function describeRule(r: { ruleType: string; condition: unknown }): string {
  const c = (r.condition ?? {}) as { conflictingActions?: unknown };
  if (r.ruleType === "rbac" && Array.isArray(c.conflictingActions) && c.conflictingActions.length >= 2) {
    return `separation of duties: ${c.conflictingActions.map(String).join(" vs ")}`;
  }
  return `${r.ruleType} rule`;
}

export function describePolicyChange(before: PolicyState, after: PolicyState): string[] {
  const out: string[] = [];
  for (const [key, label] of FIELDS) {
    if (!same(before[key], after[key])) out.push(key === "scope" ? "Scope changed" : `${label}: ${shown(before[key])} → ${shown(after[key])}`);
  }
  if (before.rules && after.rules) {
    const key = (r: { ruleType: string; condition: unknown }) => `${r.ruleType}:${JSON.stringify(r.condition ?? null)}`;
    const was = new Set(before.rules.map(key));
    const now = new Set(after.rules.map(key));
    for (const r of after.rules) if (!was.has(key(r))) out.push(`Rule added: ${describeRule(r)}`);
    for (const r of before.rules) if (!now.has(key(r))) out.push(`Rule removed: ${describeRule(r)}`);
  }
  return out;
}

export type PolicyHistoryEntry = { version: number; changedBy: string | null; changedAt: string; changes: string[] };

/**
 * Each saved version, newest first, with what it changed. `versions` are the
 * recorded prior states (version N is the state before version N+1 was made);
 * `current` is the policy now.
 */
export function policyHistory(versions: { version: number; snapshot: PolicyState; changedBy: string | null; changedAt: string }[], current: PolicyState & { version: number }): PolicyHistoryEntry[] {
  const byVersion = new Map(versions.map((v) => [v.version, v]));
  return [...versions]
    .sort((a, b) => b.version - a.version)
    .map((v) => {
      const next = byVersion.get(v.version + 1)?.snapshot ?? (current.version === v.version + 1 ? current : null);
      return { version: v.version + 1, changedBy: v.changedBy, changedAt: v.changedAt, changes: next ? describePolicyChange(v.snapshot, next) : [] };
    });
}
