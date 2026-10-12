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
| WID-C01 Approval policy | P2 | Waiting on the owner | Maker/checker on loosening request-policy changes: an organization with one administrator could not loosen a policy |
| WID-C02 Revocation and expiry | P2 | Partly fixed | Integration tests for a connector outage and a failed deprovisioning; owner decision on connectors carrying out a leaver's removals |
| WID-C03 Gateway bypass | P3 | Partly fixed | Owner decision: make the gateway the only path (agents without direct credentials) |
| WID-H01 Identity correlation | P3 | Partly fixed | Merge reversal and a source-priority policy (owner input) |
| WID-H02 Idempotency and retries | P2 | Partly fixed | Process-crash tests; compensation for a partly created account |
| WID-H03 Incomplete syncs | P2 | Partly fixed | A test for a failed page in the middle of a read |
| WID-H04 Rogue access provenance | P2 | Partly fixed | Accepted-exception and false-positive closure for rogue findings on human accounts |
| WID-H05 Connector security | P3 | Partly fixed | Nothing left from the tracker's list; the register's closure criteria are for its audit to judge |
| WID-H06 Automation credentials | P2 | Fixed | None: the register confirmed it fixed (12 Oct, 12:40 IST) |
| WID-H07 Audit and erasure | P3 | Waiting on the owner | Retention defaults, free-text minimisation and crypto-erasure need owner and legal input |
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

Linked with WID-H04: rogue access approved afterwards is now recorded as
such (PR #115).

**Waiting on the owner:** maker/checker on request-policy changes. The plan
is ready:
- a change that loosens control is held until another administrator
  approves it. That covers turning on auto-approval, raising the risk
  threshold, dropping an approver, dropping the justification, lengthening
  the maximum duration, or making something requestable;
- tightening changes apply at once.

It needs a decision first:
- an organization with a single administrator could then never loosen a
  policy;
- three E2E specs that turn on auto-approval would need a second
  administrator.

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

**Done:** an account already correlated to a person keeps that person when
a later reconciliation would match it to someone else, to no one, or to
several people (a reassigned email, a reused username). The move is held:
- it is counted on the run (`relink_held`, migration 0139, applied) and
  shown in the connection's sync results;
- the held accounts are listed in the run's `account.reconciled` audit
  event (`relinkHeldAccounts`).

A person relinks by hand if the account really changed hands. Accounts
with no person are still matched afresh. See `planReconciliation` in
`accountRules.ts`; test in `accountRules.test.ts`, "WID-H01".

Priority lowered to P3: what remains needs owner input.

**Next:**
- Merge reversal.
- A source-priority policy.

### WID-H02: idempotency and partial failure (P2, partly fixed)

**Done:** an LDAP answer that a change is already in place counts as done
(PR #107; `ldapWrite.ts`, `alreadyApplied`). The knowledge base no longer
claims "never applied twice".

**Done (2026-10-12):** the three items below, decided under the owner's
standing instruction to prioritise and fix findings without asking.
- **One key per task.** The system receives one `Idempotency-Key` per task
  and change (`systemKey` in `connectorWriteRules.ts`: the task plus a
  fingerprint of the request), the same on every try. A corrected request
  gets a new key. WonderID's own record stays one row per attempt and now
  stores the key the system saw (`system_key`, migration 0141).
- **Failures are classified** (`writeFailureKind`):
  - not applied: 429, or a connection that never reached the system;
  - unclear: a timeout, a dropped connection, 408, 5xx, or an unreadable
    success answer;
  - refused: other 4xx, or blocked by WonderID.
- **Declared per connection type.** A definition marks an http change
  `repeatable` when sending it twice cannot make it twice. LDAP changes
  always are; in `scim-2`, adding, removing and disabling are, creating a
  user is not.
- **Read before a retry.** An unclear outcome is retried automatically
  only for a repeatable change. Otherwise:
  - the change is not sent again;
  - a verification sync reads the system, and reconciliation closes the
    task if the change is there;
  - "Try again" is refused (`READ_PENDING`) until a complete read of the
    connection that started after the failure has finished
    (`connector_uncertain_at`, migration 0142; `readFinishedSince`).

  A connector run that never reported back is treated the same way.

Tests:
- `connectorWriteRules.test.ts`, `connectorFulfilmentRules.test.ts` and
  `framework.test.ts` ("WID-H02");
- E2E `connector-provisioning`:
  - a repeatable change: three tries with one key;
  - a non-repeatable change the system made, then answered 503: sent
    once, and closed by the read;
  - a non-repeatable change that failed: the retry is refused until the
    read finishes, then works with the same key.

**Next:**
- Crash and timeout tests at the process level (a run killed mid-write).
- Compensation for a partly created account (an account created, its
  access not).

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

**Done:** thresholds per kind.
- People (`identity`) are held above 10%, or the organization's threshold
  when it is lower (`massMissingThreshold` in `stagingRules.ts`).
- Any kind, at any size, is held when every record of it would go missing
  at once (`stage_mark_missing`, migration 0140). Before, a kind with
  fewer than 20 records was never held.

Tests:
- `stagingRules.test.ts`, "massMissingThreshold (WID-H03)";
- `tests/integrations/staging-missing.sql`, check 4b: 20/20 passed live.

**Next:**
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

**Done:** more ways an IPv6 address hides a private one are refused
(`isPrivateAddress` in `outboundPolicy.ts`):
- 6to4 (`2002::/16`) and IPv4-compatible (`::a.b.c.d`) addresses are
  judged by the IPv4 address inside them;
- Teredo (`2001:0::/32`) and local-use NAT64 (`64:ff9b:1::/48`) are
  always refused;
- the 6to4 relay range (`192.88.99.0/24`) is refused.

**Done:** DNS rebinding tests (`outboundFetch.test.ts`):
- a name that is public on one lookup and loopback on the next is refused
  at the connect that would reach loopback;
- a name that resolves to a public and a private address is refused.

A redirect is checked hop by hop with the same check as the first
request (`checkOutboundUrl`, then the connect-time lookup). Under the
strict policy no local server can be the first hop, so the existing
redirect-to-metadata test covers that path.

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

**Done:** a SQL test of the audit trail's rules
(`tests/foundation/audit-trail-integrity.sql`), run against the live
database on 12 October and passing. It checks that:
- a row cannot be updated or deleted;
- the purge refuses a cut inside 365 days;
- a legal hold stops it;
- once released, it removes only the old row, records the purge, and the
  chain still verifies.

**Waiting on the owner and legal:**
- a default retention period;
- minimising free-text metadata;
- crypto-erasure.

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

