/**
 * WID-H04 — pure rules (#9) for closing a rogue-access finding: how it
 * ended is part of the record. The access was removed, or it was approved
 * after it appeared; the two are never shown as the same thing, and the
 * ledger keeps the earlier ROGUE status either way.
 */

export type RogueGrantState = {
  revokedAt: string | null;
  missingFromSourceAt: string | null;
  requestId: string | null;
  packageItemId: string | null;
} | null;

export type RogueResolution = { type: "verified_fixed" | "approved_afterwards"; reason: string; requestId: string | null };

/** How a finding that is no longer rogue ended, from its grant now (null: the grant is gone). */
export function rogueResolution(grant: RogueGrantState): RogueResolution {
  if (!grant || grant.revokedAt || grant.missingFromSourceAt) {
    return { type: "verified_fixed", reason: "The access was removed: the system no longer has it.", requestId: null };
  }
  if (grant.requestId) {
    return { type: "approved_afterwards", reason: "Approved after it appeared, through an access request. It was rogue until then.", requestId: grant.requestId };
  }
  if (grant.packageItemId) {
    return { type: "approved_afterwards", reason: "Approved after it appeared, through an access package assignment. It was rogue until then.", requestId: null };
  }
  return { type: "approved_afterwards", reason: "An approval or exception now covers it. It was rogue until then.", requestId: null };
}

/**
 * WID-H04 (owner decision 2026-10-12): a person closes a rogue-access
 * finding without removing the access in one of two ways, both with a
 * reason:
 * - an accepted exception, which ends on a date at most 90 days away; the
 *   finding then reopens;
 * - a false positive, which closes the finding; the same grant is not
 *   flagged again.
 * Someone other than the account's owner decides (checked by the caller).
 */
export const ROGUE_EXCEPTION_MAX_DAYS = 90;

export type RogueDecisionInput = { outcome?: unknown; reason?: unknown; until?: unknown };
export type RogueDecision = { outcome: "exception"; reason: string; until: string } | { outcome: "false_positive"; reason: string; until: null };

export function validateRogueDecision(input: RogueDecisionInput, now: Date): RogueDecision | { error: string } {
  const outcome = input.outcome;
  if (outcome !== "exception" && outcome !== "false_positive") return { error: "outcome: exception or false_positive" };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return { error: "reason: say why" };
  if (reason.length > 1000) return { error: "reason: at most 1000 characters" };
  if (outcome === "false_positive") return { outcome, reason, until: null };
  if (typeof input.until !== "string" || !input.until) return { error: "until: the date the exception ends" };
  // A date alone means the end of that day (UTC).
  const until = new Date(/^\d{4}-\d{2}-\d{2}$/.test(input.until) ? `${input.until}T23:59:59Z` : input.until);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return { error: "until: a date in the future" };
  if (until.getTime() > now.getTime() + ROGUE_EXCEPTION_MAX_DAYS * 86_400_000) return { error: `until: at most ${ROGUE_EXCEPTION_MAX_DAYS} days from today` };
  return { outcome, reason, until: until.toISOString() };
}

/**
 * RISK-P0-13 — authorizing rogue access afterwards: a person approves the
 * access as it stands (`authorize`) or recognizes it as legacy access that
 * predates WonderID (`legacy`), with a reason and, optionally, an end date
 * (time-bound: the access is removed then, ACCESS-P0-32). At most ten years,
 * the longest a request may run. `package` covers it by an access package
 * the identity already holds: the access is added to that package. Pure (#9).
 */
export const ROGUE_AUTHORIZATION_MAX_DAYS = 3650;
export type RogueAuthorizationInput = { kind?: unknown; reason?: unknown; until?: unknown; packageId?: unknown };
export type RogueAuthorization = { kind: "authorize" | "legacy" | "package"; reason: string; until: string | null; packageId?: string };

export function validateRogueAuthorization(input: RogueAuthorizationInput, now: Date): RogueAuthorization | { error: string } {
  const kind = input.kind ?? "authorize";
  if (kind !== "authorize" && kind !== "legacy" && kind !== "package") return { error: "kind: authorize, legacy or package" };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return { error: "reason: say why this access is approved" };
  if (reason.length > 1000) return { error: "reason: at most 1000 characters" };
  if (kind === "package") {
    const packageId = typeof input.packageId === "string" ? input.packageId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packageId)) return { error: "packageId: choose a package the identity holds" };
    // The package assignment decides how long it lasts.
    return { kind, reason, until: null, packageId };
  }
  if (input.until === undefined || input.until === null || input.until === "") return { kind, reason, until: null };
  if (typeof input.until !== "string") return { error: "until: a date" };
  const until = new Date(/^\d{4}-\d{2}-\d{2}$/.test(input.until) ? `${input.until}T23:59:59Z` : input.until);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return { error: "until: a date in the future" };
  if (until.getTime() > now.getTime() + ROGUE_AUTHORIZATION_MAX_DAYS * 86_400_000) return { error: "until: at most ten years from today" };
  return { kind, reason, until: until.toISOString() };
}

/** The request's justification for an approval given afterwards: what it was, and why. */
export function authorizationJustification(a: RogueAuthorization, ticketNumber: string | null, packageName?: string | null): string {
  const what = a.kind === "legacy" ? "Recognized as legacy access" : a.kind === "package" ? `Added to the access package ${packageName ?? ""}`.trimEnd() : "Approved afterwards";
  return `${what}${ticketNumber ? ` (${ticketNumber})` : ""}: ${a.reason}`.slice(0, 2000);
}

/** Whether the person deciding is the account's owner (not allowed). */
export function decidesOwnAccess(deciderIdentityId: string | null, accountIdentityId: string | null): boolean {
  return Boolean(deciderIdentityId && accountIdentityId && deciderIdentityId === accountIdentityId);
}

/** Whether an accepted exception has ended. */
export function exceptionEnded(until: string | null, now: Date): boolean {
  return Boolean(until) && Date.parse(until!) <= now.getTime();
}

/**
 * RISK-P0-13 — the rogue-access trend: per week (Monday, UTC) for the last
 * `weeks` weeks, how many findings were found, how many were resolved, and
 * how many were still open at the week's end. Pure (#9).
 */
export type RogueTrendRow = { createdAt: string; resolvedAt: string | null };
export type RogueTrendWeek = { label: string; found: number; resolved: number; open: number };

export function rogueTrend(rows: RogueTrendRow[], now: Date, weeks = 8): RogueTrendWeek[] {
  const DAY = 86_400_000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  const out: RogueTrendWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = monday - i * 7 * DAY;
    const end = start + 7 * DAY;
    const at = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
    out.push({
      label: new Date(start).toISOString().slice(5, 10),
      found: rows.filter((r) => at(r.createdAt) >= start && at(r.createdAt) < end).length,
      resolved: rows.filter((r) => at(r.resolvedAt) >= start && at(r.resolvedAt) < end).length,
      open: rows.filter((r) => at(r.createdAt) < end && !(at(r.resolvedAt) < end)).length,
    });
  }
  return out;
}
