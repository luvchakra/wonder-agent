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
