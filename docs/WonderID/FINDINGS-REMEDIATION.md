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
| WID-C02 Revocation and expiry | P2 | Partly fixed | Integration tests for a connector outage and a failed deprovisioning; owner decision on connectors carrying out a leaver's removals |
| WID-C03 Gateway bypass | P3 | Partly fixed | Owner decision: make the gateway the only path (agents without direct credentials) |
| WID-H01 Identity correlation | P2 | Partly fixed | Stop auto-correlated accounts moving when an email is reassigned |
| WID-H02 Idempotency and retries | P2 | Partly fixed | One key per task; read the system before a retry after an unclear failure |
| WID-H03 Incomplete syncs | P2 | Partly fixed | Thresholds per kind; tests for a failed page in the middle of a read |
| WID-H04 Rogue access provenance | P2 | Partly fixed | Accepted-exception and false-positive closure for rogue findings on human accounts |
| WID-H05 Connector security | P3 | Partly fixed | Tests for a real DNS rebind and for a strict-policy redirect to a private address |
| WID-H06 Automation credentials | P2 | Fixed | None: the register confirmed it fixed (12 Oct, 12:40 IST) |
| WID-H07 Audit and erasure | P3 | Waiting on the owner | SQL test for the append-only and purge rules; retention defaults need owner and legal input |
| WID-H08 Automation address allow-list | P1 | Partly fixed | Test at the deployed ingress; document each supported deployment (the register moved it to CHANGED) |

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

**Done:** ended access shows on the request (list, page and API) whether
it is gone:
- "Ended · removal pending";
- "Ended · removed, not yet verified";
- "Ended · removal verified", only once every grant is revoked by a read of
  the system.

See `endedRemoval` in `pendingGrantRules.ts` and `ENDED` in
`access/requests/labels.ts`; tests in `pendingGrantRules.test.ts` and
`labels.test.ts`.

**Done:** removal and disable tasks are due within 1 day
(`REMOVAL_SLA_DAYS`), whatever the organization's longer SLA. Granting
keeps the SLA (`taskDueAt` in `fulfilmentTaskRules.ts`; test in
`fulfilmentTaskRules.test.ts`).

**Done:** the urgent leaver path. When a person stops working (disabled,
terminated or archived, not while serving notice):
- each live grant on their accounts gets its own removal task, marked
  "leaver", due within a day and owned by the application's owner;
- grants approved but never fulfilled are withdrawn;
- later steps open nothing twice;
- a person does each removal: no connector acts on its own (#15, and the
  lifecycle rule that a task is a person's job).

See `opensAccessRemoval` in `humanLifecycle.ts` and `openLeaverRemovals`
in `leaverRemovals.ts`; tests in `humanLifecycle.test.ts` and
`tests/e2e/leaver-removals.spec.ts`.

**Done:** escalation. A removal or account disable more than a day overdue
goes to the access managers (holders of `access.approve`), once
(`needsEscalation`, migration 0135 `escalated_at`, audit
`access.fulfilment_task_escalated`). Removal tasks also say why they exist
(`reason`: leaver or expired).

Priority lowered to P2: the urgent paths exist, and what remains is tests
and an owner decision.

**Next:**
- Integration tests for a connector outage, a delayed sync and a failed
  deprovisioning.
- **Owner decision:** may a connection with changes turned on carry out a
  leaver's removals by itself? Today a person does each one.

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

**Done:** bypass detection. For an agent that uses the gateway, the risk
evaluation flags as `gateway_bypass`:
- an observed action (from MCP, a runtime or a webhook) with no matching
  gateway decision in the 15 minutes before it;
- an action that succeeded although its decision was DENY.

Matching is on the tool, or without a tool on the action and application.
Actions before the agent's first decision are not judged. Migration 0137
adds the category (applied).

See `gatewayBypass` in `modules/risk/signals.ts`. Tests:
- `signals.test.ts`;
- `tests/e2e/runtime-gateway.spec.ts`, "WID-C03".

The knowledge base says detection is after the fact.

**Limits:**
- It sees only actions reported to WonderID.
- The evaluation reads the agent's last 200 events.

**Next (owner decision):** whether to make the gateway the only path, for
example by holding agents' target credentials so they cannot call a
system directly. Priority lowered to P3, because what remains is that
decision.

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

### WID-H03: incomplete syncs (P2, partly fixed)

**Already true:**
- Records are marked missing only for a kind read completely in a full run
  with no failures.
- The mass-missing hold.

**Done:** a run in which any kind's read stopped at a limit is partial,
not succeeded, and says why on the run (`runStatus` in `stagingRules.ts`).
Only succeeded runs are a base for the next incremental read and for the
daily full read (`lastGoodRuns`). So:
- a cut-short incremental run no longer moves the cursor;
- a cut-short full run no longer resets the daily full-read clock.

The steps after a sync still run for a partial run.

Tests:
- `stagingRules.test.ts`, "runStatus";
- E2E `connector-provisioning`, `identity-sources` and
  `connection-upgrade`: 26/26.

**Next:**
- Mass-missing thresholds per kind.
- An E2E test for a page that fails in the middle of a read.

### WID-H04: rogue access provenance (P2, partly fixed)

**Done:** a rogue-access finding that is no longer rogue closes as what
happened to its grant (`rogueResolution` in `accessFindingRules.ts`,
applied in `syncRogueAccessFindings`):
- **removed:** revoked, missing at the source, or gone. The resolution is
  `verified_fixed`.
- **approved afterwards:** still there, now covered by a request, a package
  assignment or another approval. The resolution is the new
  `approved_afterwards`, and the approving request is attached as
  `access_request` evidence.

The ledger keeps the earlier ROGUE status either way. Migration 0138 adds
the resolution and the evidence type (applied).

Tests:
- `accessFindingRules.test.ts`;
- E2E `f1-reconciliation` (removed at the source, so `verified_fixed`)
  and `connector-provisioning`.

**Next:**
- Accepted-exception and false-positive closure for rogue findings on
  human accounts.

### WID-H05: connector security (P3, partly fixed)

**Done:**
- Custom credential headers and request bodies no longer follow a redirect
  to another origin (PR #106; `outboundFetch.ts`, `credentialHeaders`).

**Next:**
- Tests for a real DNS rebind and for a strict-policy redirect to a private
  address.
- 6to4 and Teredo ranges.

### WID-H06: automation credential scope (P2, fixed)

The register marked it FIXED on 12 October (12:40 IST), from the code and
committed tests. Production was not exercised in that audit.

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

**Done:** refused calls are audited (`automation.api_call`, outcome
failure, `refused` = the reason):
- pending, revoked or expired credentials (401), and an address that is not
  allowed (403), at most once per credential and reason a minute
  (`refusalAuditDue`);
- the first call over the rate limit in each minute (429,
  `firstOverRateLimit`), so a flood cannot fill the trail.

A key that matches no credential has no organization to audit to, so it is
answered 401 only.

**Done:** the database refuses an expiry, or a requested extension, more
than 365 days ahead of the write (migration 0134, trigger
`automation_credentials_expiry_cap`; applied, advisors unchanged).

Tests:
- `automationCredentialRules.test.ts`;
- `tests/e2e/automation-credentials.spec.ts`, which covers the register's
  closure criteria:
  - denied access: pending, address, rate limit, expired, revoked;
  - revoke and rotate: after a rotation the old secret gets 401 at once and
    the new one works;
  - cross-tenant: the credential reads only its own organization;
  - the refusal audit rows, and the database refusing 400 days.

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

