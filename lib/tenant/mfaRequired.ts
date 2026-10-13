/**
 * FOUNDATION-P0-27 — an organization can require multi-factor
 * authentication (Global Configuration `security.mfaRequired`). Pure, so the
 * rule is the same in getTenantContext(), the API refusal and the tests; the
 * database applies the same rule in current_tenant_ids() (migration 0152).
 */

/** Whether a membership's organization needs MFA before this session may act in it. Automation members are exempt. */
export function mfaStepUpNeeded(m: { mfaRequired?: boolean; automation?: boolean }, aal: "aal1" | "aal2" | null | undefined): boolean {
  return m.mfaRequired === true && m.automation !== true && aal !== "aal2";
}

/** The refusal an API caller gets while its session still needs MFA. */
export const MFA_STEP_UP_MESSAGE = "This organization requires multi-factor authentication. Verify with your authenticator app, then try again.";
