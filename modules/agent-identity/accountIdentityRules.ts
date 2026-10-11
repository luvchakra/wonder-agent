/**
 * IDENTITY-P0-20 — pure rules (#9) for the non-human identities that
 * imported accounts become: which person a source's owner value names. The
 * service (accountIdentities.ts) loads the people and writes the identities.
 */

export type PersonRef = { id: string; email: string | null; username: string | null; sourceNativeId: string | null };

/**
 * The one person an owner value names: their WonderID id, their id in a
 * source, their email or their username. Ambiguous or unknown values name
 * nobody; the identity then waits in the unowned queue rather than being
 * given a guessed owner (§17.6).
 */
export function resolveOwner(value: string | null, people: PersonRef[]): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  const byId = people.filter((p) => p.id === lower);
  if (byId.length === 1) return byId[0].id;
  for (const match of [
    (p: PersonRef) => p.sourceNativeId === v,
    (p: PersonRef) => (p.email ?? "").toLowerCase() === lower,
    (p: PersonRef) => (p.username ?? "").toLowerCase() === lower,
  ]) {
    const found = people.filter(match);
    if (found.length === 1) return found[0].id;
    if (found.length > 1) return null;
  }
  return null;
}
