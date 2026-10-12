# High-risk findings: remediation tracker

What WonderID is doing about each finding in
[`HIGH-RISK-FINDINGS.md`](HIGH-RISK-FINDINGS.md). That register is
maintained by the hourly audit (ChatGPT, authorised by the owner), which
updates it freely. Claude Code reads it and never edits it (CLAUDE.md
§19.12). This tracker
holds:
- the priority of each finding;
- its status;
- what was done, with evidence;
- what comes next.

The owner decided on 2026-10-12 that Claude sets the priorities and works
through them without asking, keeping this file current in the same pull
request as each fix.

**Priority**
- **P1:** now; the next pull requests.
- **P2:** next, after the P1 items.
- **P3:** later, or waiting on a decision only the owner or legal can
  make.

**Status:** Not started, In progress, Partly fixed, Fixed (closure criteria
met, with evidence), or Waiting on the owner.

**Last updated:** 12 October 2026

## Summary

| Finding | Priority | Status | Next step |
|---|---|---|---|
| WID-C01 Approval policy | P2 | Partly fixed | Maker/checker on request-policy changes |
| WID-C02 Revocation and expiry | P1 | In progress | Show "expired, removal pending" on the request; priority deadlines for removals |
| WID-C03 Gateway bypass | P2 | Partly fixed | Flag runtime events that have no matching gateway decision |
| WID-H01 Identity correlation | P2 | Partly fixed | Stop auto-correlated accounts moving when an email is reassigned |
| WID-H02 Idempotency and retries | P2 | Partly fixed | One key per task; read the system before a retry after an unclear failure |
| WID-H03 Incomplete syncs | P2 | Not started | A cut-short incremental run counts as partial and does not move the cursor |
| WID-H04 Rogue access provenance | P2 | Not started | A separate "approved afterwards" resolution; closure for findings on human accounts |
| WID-H05 Connector security | P3 | Partly fixed | Tests for a real DNS rebind and for a strict-policy redirect to a private address |
| WID-H06 Automation credentials | P2 | Partly fixed | Audit 401 and 429 refusals; a database cap on expiry |
| WID-H07 Audit and erasure | P3 | Waiting on the owner | SQL test for the append-only and purge rules; retention defaults need owner and legal input |
| WID-H08 Automation address allow-list | P1 | Partly fixed | Test at the deployed ingress; document each supported deployment |

## Detail

### WID-C01: approval policy (P2, partly fixed)

**Done:**
- Catalog requests already blocked self-approval in the planner, the
  service and the database (migration 0093).
- Owner decision 2026-10-12: nobody approves or rejects an agent request
  they made either, whatever the SoD policy (`requests.ts`,
  `decideAccessRequest`, SELF_APPROVAL; `tests/e2e/sod.spec.ts`).
- Owner decision 2026-10-12: high and critical risk always need a person,
  whatever a policy's threshold (`requestRules.ts`, `ALWAYS_HUMAN_RISK`;
  `requestRules.test.ts`).
- Auto-approval is recorded distinctly (audit `access.request_auto_approved`).

**Next:**
- Maker/checker on request-policy changes.
- Link with WID-H04 for rogue access approved afterwards.

### WID-C02: urgent revocation and time-bound access (P1, in progress)

**Already true:** expiry and verified removal are separate states, and
removal counts only after a later read of the system no longer finds the
access.

**Done:** a removal marked done that no read of the system has confirmed
after 2 days reminds its owner, at most daily, that the access may still be
there. This covers removals done by a person and by a connector
(`needsUnconfirmedRemovalReminder`, `UNCONFIRMED_REMOVAL_DAYS` in
`fulfilmentTaskRules.ts`, in the daily sweep `remindOverdueFulfilmentTasks`;
tests in `fulfilmentTaskRules.test.ts`).

**Next, in order:**
1. Show "expired, removal pending" against "removal verified" on the
   request.
2. Give removals priority deadlines.
3. An urgent leaver path: one removal per grant, an owner and a deadline,
   escalated.

### WID-C03: gateway coverage (P2, partly fixed)

**Done:**
- Owner decision 2026-10-12: the kill switch, tool, MCP server and session
  suspension, and a decision that cannot be worked out, block in every
  mode, Observe included (`gateway.ts`, `effectiveDecisionOf`, which also
  reads the decision's steps).
- A suspended tool is hidden by the tool filter in every mode
  (`runtimeDecision.ts` names emergency controls first).
- The knowledge base says only calls sent to the gateway are checked.
- Tests: `gateway.test.ts`, `tests/e2e/emergency-controls.spec.ts`.

**Next:**
- Flag runtime events that have no matching gateway decision (bypass
  detection).

### WID-H01: identity correlation (P2, partly fixed)

**Done:** a single match on a terminated or archived identity goes to
Pending Matches (PR #106; `identitySourceRules.ts`, `correlate`).

**Next:**
- Freeze auto-correlated accounts, so a reassigned email cannot move them.
- Merge reversal; a source-priority policy.

### WID-H02: idempotency and partial failure (P2, partly fixed)

**Done:** an LDAP answer that a change is already in place counts as done
(PR #107; `ldapWrite.ts`, `alreadyApplied`). The knowledge base no longer
claims "never applied twice".

**Next:**
- One key per task instead of per attempt.
- Read the system before a retry after an unclear failure.
- Declare which connection types honour the key.

### WID-H03: incomplete syncs (P2, not started)

**Next:**
- A cut-short incremental run counts as partial and does not move the
  cursor.
- Thresholds per kind.

### WID-H04: rogue access provenance (P2, not started)

**Next:**
- A separate "approved afterwards" resolution, or the request id on the
  finding.
- Accepted-exception and false-positive closure for rogue findings on human
  accounts.

### WID-H05: connector security (P3, partly fixed)

**Done:**
- Custom credential headers and request bodies no longer follow a redirect
  to another origin (PR #106; `outboundFetch.ts`, `credentialHeaders`).

**Next:**
- Tests for a real DNS rebind and for a strict-policy redirect to a private
  address.
- 6to4 and Teredo ranges.

### WID-H06: automation credential scope (P2, partly fixed)

**Done** (owner decision 2026-10-12): an automation credential never holds
`access.approve`, `agent.certify` or `automation.manage`. Three layers
enforce it:
- they cannot be assigned (`roleEscalation`, `HUMAN_ONLY_PERMISSIONS`);
- they are stripped from an automation call's permissions
  (`getTenantContext`);
- the decision routes refuse automation callers (`refuseAutomationCaller`):
  access decisions, certification decisions, attestations and onboarding
  approval.

Test: `automationCredentialRules.test.ts`.

**Done:** giving a role to an approved credential puts it back to pending,
so it stops working at once. It needs another administrator's approval:
not its creator, and not whoever gave the role. Enforced in the service
and by the database (migration 0133, `automation_credentials_change_four_eyes`).
Test: `tests/e2e/automation-credentials.spec.ts`, "WID-H06". Removing a role
only reduces power, so it needs no approval.

**Next:**
- Audit 401 and 429 refusals.
- A database cap on expiry.

### WID-H07: audit and erasure (P3, waiting on the owner)

**Next:**
- A SQL test for the append-only trigger and `purge_audit_logs` (can be
  done now).
- Waiting on the owner and legal: a default retention period, minimising
  free-text metadata, crypto-erasure.

### WID-H08: automation credential address allow-list (P1, partly fixed)

**Done:** the caller's address now comes only from a header the
platform's edge sets (`trustedClientIp` in `automationCredentialRules.ts`):
- a self-hosted deployment names the header its ingress overwrites
  (`CLIENT_IP_HEADER`, documented in `.env.local.example`), and the last
  hop is used;
- on Vercel, `x-vercel-forwarded-for` or `x-real-ip`, which Vercel sets
  itself;
- otherwise the address is unknown, and a credential limited to certain
  addresses is refused (fails closed).

A caller's own `x-forwarded-for` is never trusted. Test:
`automationCredentialRules.test.ts`, "WID-H08".

**Next:**
- Verify at the deployed ingress (Vercel production) that spoofed headers
  cannot change the address.
- Document the setting in the self-hosting kit.

