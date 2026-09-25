/**
 * EXPERIENCE-P0-17 (user decision, 2026-09-25): screens name the four
 * access views with the friendly label and the model term together.
 * SHOULD/CAN/DID stay the canonical model terms (CLAUDE.md §9, UI rules
 * §11); these are only how screens say them. One source, so every screen
 * says it the same way.
 */
export const ACCESS_VIEW = {
  should: "Approved (SHOULD)",
  can: "Effective Access (CAN)",
  did: "Observed (DID)",
  now: "Current Request (NOW)",
} as const;

/** "Approved (SHOULD) vs Effective Access (CAN) vs Observed (DID)". */
export const ACCESS_VIEWS_COMPARED = `${ACCESS_VIEW.should} vs ${ACCESS_VIEW.can} vs ${ACCESS_VIEW.did}`;
