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

**Last updated:** 12 October 2026 (owner decisions recorded)

## Summary

| Finding | Priority | Status | Next step |
|---|---|---|---|
| WID-C01 Approval policy | P3 | Risk accepted by the owner | None: one administrator may loosen a request policy, audited (owner decision 12 Oct). Revisit under "Decisions to come" |
| WID-C02 Revocation and expiry | P2 | Partly fixed | Done: the connector disables a leaver's account at once (owner decision 12 Oct). For the register to assess |
| WID-C03 Gateway bypass | P2 | Partly fixed | Done: a per-agent "gateway only" setting; a direct call is critical and suspends the agent at the gateway (owner decision 12 Oct). For the register to assess |
| WID-H01 Identity correlation | P2 | Fixed (owner decisions 12 Oct) | Conflict list; unlink with undo for source records and accounts |
| WID-H02 Idempotency and retries | P2 | Partly fixed | Nothing open on our side; for the register to assess |
| WID-H03 Incomplete syncs | P2 | Partly fixed | Checksums where a system offers one |
| WID-H04 Rogue access provenance | P2 | Partly fixed | Done: accepted exception (90 days at most, decided by someone else) and false positive (owner decision 12 Oct). For the register to assess |
| WID-H05 Connector security | P3 | Partly fixed | Nothing left from the tracker's list; the register's closure criteria are for its audit to judge |
| WID-H06 Automation credentials | P2 | Fixed | None: the register confirmed it fixed (12 Oct, 12:40 IST) |
| WID-H07 Audit and erasure | P2 | Fixed | Retention defaults (0143), typed text out of audit records, identifiers only in audit records, and erasure of accounts, source values and connector write targets done |
| WID-H08 Automation address allow-list | P1 | Fixed | Spoofing tested end to end at the production edge (nightly from now on); each deployment documented. For the register to assess |

## Owner decisions

Every decision the owner makes on a finding is recorded here, newest first,
in the same pull request that records or acts on it. When a finding needs
a decision, Claude lists the options with their upsides, downsides and
build effort, recommends one, and the owner chooses. The 12 October set
was chosen in the sheet "WonderID: decisions pending with the owner".

| Date | Finding | Question | Decision | What it means for the work |
|---|---|---|---|---|
| 12 Oct 2026 | WID-C01 | Should a second administrator approve changes that loosen a request policy? | **No; leave as it is.** One administrator may loosen a policy; the change is audited. | No maker/checker build. The risk is accepted; it is revisited under "Decisions to come". |
| 12 Oct 2026 | WID-C02 | May a connection carry out a leaver's removals? | **The connector disables the leaver's account at once; removing each access stays a person's task.** | Done: when a person is disabled or terminated, each account on a connection that supports disabling, with changes turned on, is disabled by the connector. This is an approved automation path under non-negotiable #15. Failures become a person's task. The per-access removal tasks stay as today. |
| 12 Oct 2026 | WID-C03 | Should the Runtime Gateway be the only path for agents? | **A per-agent "gateway only" setting.** | Done: when on, a detected direct call is a critical finding and the agent is suspended at the gateway automatically (`agent_suspension` control). The owner approved that automatic suspension under #15. |
| 12 Oct 2026 | WID-H01 | How is a wrong match between a source record and a person undone? | **Unlink with undo.** | Done: an administrator unlinks a source record (values it changed restored from history; never re-matched to that person by itself; the person's matched accounts go back for matching) or an account (goes back for matching, never to that person by itself); audited (migrations 0148, 0149). |
| 12 Oct 2026 | WID-H01 | Which identity source wins when sources disagree? | **The current rule, plus a conflict list.** | Done: the higher-priority source still wins its owned fields; each disagreement appears on a review list with both values and sources (migrations 0146/0147). |
| 12 Oct 2026 | WID-H04 | How can a rogue-access finding on a person's account be closed? | **Accepted exception and false positive, both governed.** | Done: an accepted exception needs a reason, an end date at most 90 days away, and someone other than the account's owner; the finding reopens when it ends. A false positive needs a reason. Both are audited and kept in the finding's history. |
| 12 Oct 2026 | WID-H07 | What is the default audit-log retention? | **1 year on Free and Pro, 3 years on Max, 7 years on Enterprise.** | Done: plan defaults changed (`PLAN_DEFAULTS`), existing subscriptions raised and less than a year refused (migration 0143). |
| 12 Oct 2026 | WID-H07 | Should typed text stay in audit records? | **No: keep typed text out of audit records.** | Done: audit rows keep the record's id and a keyed fingerprint of the text (`metadata.typedText`); the words stay on the request, task or finding (migration 0150 gave the last two a home). |
| 12 Oct 2026 | WID-H07 | How is personal data in audit records erased? | **Identifiers only.** | Done: audit records hold ids, field names and fingerprints, never personal data, and erasure reaches what those ids point to (accounts, source values, connector write targets, guests and partners). |
| 12 Oct 2026 | WID-H06 | May an automation credential approve or certify? | **Never.** | Done: `access.approve`, `agent.certify` and `automation.manage` are human-only, in three layers. |
| 12 Oct 2026 | WID-C03 | Do emergency controls block in Observe mode? | **Yes, in every mode.** | Done: kill switch, tool, MCP server and session suspension, and an undecidable decision block in every mode. |
| 12 Oct 2026 | WID-C01 | May anyone decide their own agent request? | **No, whatever the SoD policy.** | Done: `SELF_APPROVAL` refusal in `decideAccessRequest`. |
| 12 Oct 2026 | WID-C01 | May auto-approval cover high or critical risk? | **No: high and critical always need a person.** | Done: `ALWAYS_HUMAN_RISK` in `requestRules.ts`. |
| 12 Oct 2026 | All | Who prioritises the findings? | **Claude, without asking**, tracked in this file. | This tracker's priorities and order of work. |

## Decisions to come

Decisions known to be ahead. Until each is made, the current behavior
stands. Claude raises each one with options when its trigger arrives.

| Finding | Question | Trigger | Until then |
|---|---|---|---|
| WID-C01 | Add a second-administrator approval for loosening request policies after all? | An enterprise customer or a SOX/SOC 2 auditor asks for maker/checker on configuration. | One administrator may loosen a policy, audited. |
| WID-C02 | Should connectors also carry out a leaver's access removals (not only disable the account)? | Once disable-on-leave has run in production and its failure rate is known. | People remove each access; the connector only disables the account. |
| WID-C02 | Should disable-on-leave be a per-connection setting instead of following the connection's changes switch? | A customer wants changes on for approved requests but not for leavers. | It follows the changes switch and the connection type's support for disabling. |
| WID-C03 | Should WonderID hold agents' target credentials so the gateway becomes real prevention? | A customer needs prevention rather than detection, or detection proves too late. | Detection plus automatic suspension for agents set to "gateway only". |
| WID-C03 | How is an agent suspended by "gateway only" restored: by any administrator, or only after a review? | The first real suspension, or a customer asking for a review step. | Anyone with `runtime.emergency` lifts the `agent_suspension` control on the Runtime page, with a reason; audited. |
| WID-H01 | Should email-only matches stop linking automatically (only stable ids and employee numbers)? | Unlink-with-undo is used often, which means wrong email matches are common. | Email matching continues; wrong links are undone with unlink. |
| WID-H07 | Per-person encryption keys (crypto-erasure)? | An enterprise customer or regulator requires it. | Identifiers only, once built. |
| WID-H07 | What happens to audit rows written before "identifiers only" that still hold personal data? | When identifiers-only ships. | They stay, under the legal-obligation exemption; audit rows can never be changed. |

## Detail

### WID-C01: approval policy (P3, risk accepted by the owner)

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

**Owner decision (12 Oct): leave as it is.** One administrator may loosen
a request policy; the change is audited. The plan below was offered and not
taken; it is kept for if the decision is revisited (see "Decisions to
come"):
- a change that loosens control is held until another administrator
  approves it. That covers turning on auto-approval, raising the risk
  threshold, dropping an approver, dropping the justification, lengthening
  the maximum duration, or making something requestable;
- tightening changes apply at once.

Its cost was the reason:
- an organization with a single administrator could never loosen a
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

**Done:** an E2E test of a leaver's removal through outage and failure
(`connector-provisioning.spec.ts`, "WID-C02 leaver"; 22/22 locally). Even
with writes on, leaving opens a person's removal task and no connector
write. Then:
- **outage:** the system is down, so the read fails; the task stays open
  and the grant pending removal;
- **failed deprovisioning:** someone marks the removal done, but the
  system still has the access. The task stays completed, not verified, and
  the grant `removed_unverified`, not revoked;
- **recovery:** once the access is really gone, the next read verifies
  the task and revokes the grant.

**Owner decision (12 Oct):** the connector disables a leaver's account at
once; removing each access stays a person's task.

**Done:** disable-on-leave. When a person stops working (disabled,
terminated or archived), each of their accounts gets a disable task
(reason `leaver`) that the connector carries out at once, the approved
automation path under #15, if:
- it is a real account on the system (an id and the connection it came
  from), not disabled and not a placeholder;
- its connection has changes turned on and supports disabling.

It goes through the usual write path: the mass-change guard, one key per
change, verification by the next read. A failure stays with the
application's owner. Accounts no connector can disable get no extra task.
Removing each access stays a person's task.

See `accountsToDisableOnLeave` in `connectorFulfilmentRules.ts` and
`disableOnLeave` in `leaverRemovals.ts`. Tests:
- `connectorFulfilmentRules.test.ts`;
- E2E `connector-provisioning`, "WID-C02 leaver": eve leaves, the connector
  disables her account (one PATCH), and her access removal stays a
  person's task through an outage and an unconfirmed removal.

**Next:** none of ours; see "Decisions to come" for the per-connection
setting and connector removals.

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

**Owner decision (12 Oct):** a per-agent "gateway only" setting, not
credential brokering.

**Done:** the "gateway only" setting. When it is on for an agent:
- a detected direct call (`gateway_bypass`) is a critical finding
  (`applyGatewayOnlyOverride` in `scoring.ts`);
- the agent is suspended at the gateway at once: a new emergency control,
  `agent_suspension` (target: the agent's id), engaged by the system
  (`suspendAgentAtGateway` in `emergency.ts`), audited. The decision engine
  denies every call for a suspended agent (`AGENT_SUSPENDED`, which blocks
  in every mode, Observe included) and hides its tools. This is the
  automatic remediation the owner approved under #15;
- an administrator lifts it on the Runtime page, like any other control.

The setting is `agents.gateway_only` (migration 0144, applied with the new
control type). It is turned on or off on the agent page (API keys card,
folded) or with `PUT /api/v1/agents/{id}/gateway-only`, and needs
`runtime.emergency`. Audited as `agent.gateway_only_changed`.

The first trigger revokes no keys, so lifting the suspension restores the
agent. The existing rule still applies too: a critical finding moves an
ACTIVE agent to RESTRICTED.

Tests:
- `runtimeDecision.test.ts`, `emergency.test.ts`, `rules.test.ts`
  ("WID-C03, gateway only");
- E2E `runtime-gateway`, "WID-C03 gateway only": allowed in Observe mode
  before; after the setting and a direct call, the finding is critical and
  the next call is refused (`AGENT_SUSPENDED`).

**Next:** none of ours; see "Decisions to come" (credential brokering, how
a suspended agent is restored).

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

**Owner decisions (12 Oct):** unlink with undo, and the current
source-priority rule plus a conflict list.

**Done (owner decision, 12 Oct):** the conflict list. When a
lower-priority source sends a different value for a field a higher-priority
source owns, the higher value still wins (unchanged), and the disagreement
is kept in `identity_source_conflicts` (migrations 0146 and 0147, applied):
- one open row per person, field and disagreeing source, with both values
  and both sources; custom attributes are listed as `attributes.<name>`;
- it is refreshed on each run of either source, and resolves by itself when
  the disagreeing source agrees again, or the owning source moves to its
  value;
- the import writes it (service role, same-tenant composite foreign keys);
  members read it under the identities rule; audits name fields only;
- a failure to update it is reported on the run, never undoing the import
  or holding back leavers;
- shown folded on **Pending Matches** ("Disagreements between sources").

See `planDisagreements` in `sourcedMerge.ts` and `applySourcedIdentities`.
Tests: `identitySourceRules.test.ts` ("WID-H01"), E2E `identity-sources`
("a lower-precedence source cannot overwrite…"), and
`tests/integration/identity-sources-isolation.sql`.

**Done (owner decision, 12 Oct):** unlink a source record, with undo
(migration 0148, applied).
- **History:** before the import changes an existing identity, it records
  each value it changes, with the value and provenance it replaced
  (`identity_source_changes`). If that record cannot be written, the
  change is not applied: the record fails, the run goes on.
- **Unlink:** an administrator (`identity.manage`) unlinks a record on the
  identity's page ("Source records", folded) or with
  `POST /api/v1/integrations/identity-sources/{id}/unlink`. Each field the
  record changed goes back to its value before the first change, unless it
  has changed since; such fields are kept and named. A restored status
  also restores the lifecycle state, without starting a lifecycle event.
  Audited as `identity_source.record_unlinked` and
  `identity.source_changes_undone` (field names only).
- **Never re-matched by itself:** the record remembers the identity it was
  unlinked from (`identity_source_rejections`). A later run that matches
  it only to that identity holds it in Pending Matches; a person may link
  it back, which removes the rejection.
- A record that created its identity has no history: unlinking it keeps
  the identity as it is.

See `planRevert` in `sourcedMerge.ts`, `revertSourceRecord`,
`unlinkSourceRecord` and `correlate`. Tests: `identitySourceRules.test.ts`
("WID-H01"), E2E `identity-sources` ("unlink with undo").

**Done (owner decision, 12 Oct):** accounts go back for matching
(migration 0149, applied).
- An account an administrator unlinks from a person
  (`accounts.unlinked_identity_id`) is matched afresh by the next
  reconciliation, but never to that person by itself. A link made by hand
  clears this.
- When unlinking a source record restores a person's email, username or
  name (the values accounts match on), their automatically matched accounts
  are flagged (`accounts.rematch_requested_at`). The next reconciliation
  matches them afresh, without the hold that otherwise keeps an account
  with its person, and clears the flag. Manual links and AI agents'
  accounts are untouched.

See `planReconciliation` (`accountRules.ts`), `requestAccountRematch` and
`linkAccount`. Tests: `accountRules.test.ts` ("WID-H01"), E2E
`account-inventory` (two WID-H01 cases).

Earlier notes:
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

**Done:** crash and timeout tests (`connectorFulfilment.test.ts`, 5 cases):
- a run killed mid-write is swept back to its owner as unclear, and the
  system is read again;
- an unclear outcome is sent once and never again;
- a change the system did not take is retried with the same task key;
- a task already running, or another organization's, is never run.

**Decided: no automatic compensation for a partly created account.**
Creating the account and adding its access are separate tasks. If the
account is created and the access is not, the access task stays open with
its owner and the reason. Undoing the account automatically would be a
destructive change without a person (non-negotiable #15), so it is left
to the owner.

**Next:** nothing that needs no owner decision.

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

**Done:** an E2E test for a page that fails in the middle of a read
(`tests/e2e/sync-failed-page.spec.ts`, 3/3 locally). A stub pages five
accounts two at a time:
- page 2 fails while one account was really deleted: the run does not
  succeed, and nothing is marked missing;
- once the system recovers, only the deleted account is marked missing.

**Done:** proof of completeness where a system offers it. A resource may
declare `total`: a dot path in the first response, or
`header:<Name>`. SCIM pagination always uses `totalResults`.
- A read that ends with fewer records than that count, or whose declared
  count is missing, is `short`.
- A short kind is incomplete: nothing is marked missing, and the run is
  partial with the reason ("fewer records were read than the system
  reported").

See `reportedTotal` in `http.ts`; `kindCompleteness` and `runStatus` in
`stagingRules.ts`.

Tests:
- `framework.test.ts`, "WID-H03": body count, header count, a missing
  count, SCIM, and our own record limit;
- `stagingRules.test.ts`;
- E2E `sync-failed-page.spec.ts`, 4th case: a page that answers 200 with
  nothing while `X-Total-Count` says more.

**Next:**
- Checksums, where a system offers one (none of the built-in types does
  today).

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

**Owner decision (12 Oct):** accepted exception and false positive, both
governed.

**Done:** both, for rogue-access findings on any account (people's,
service accounts' and agents' accounts alike):
- an **accepted exception** needs a reason and an end date at most 90 days
  away. The finding moves to `exception`; the next sync after the date
  reopens it (`reopenEndedExceptions`). The account's ticket stays open
  meanwhile;
- a **false positive** needs a reason. It closes the finding; a later sync
  does not flag the same grant again, and the ticket closes with the
  account's last finding;
- someone other than the account's owner decides: the decider's identity
  must not be the account's (`decidesOwnAccess`), `risk.manage` is required,
  and the result is audited (`risk.access_finding_decided`). The finding
  keeps `decided_by`, `decided_at` and `decision_reason` (migration 0145,
  applied, which also caps an exception at 90 days in the database).

UI: "Other outcomes", folded under each rogue row on the account page. API:
`POST /api/v1/findings/{id}/decision`.

Tests:
- `accessFindingRules.test.ts` ("rogue-access decisions");
- E2E `connector-provisioning`, "WID-H04": an exception over 90 days is
  refused; a 30-day exception is set from the account page; the next read
  keeps one finding; a false positive closes it and the next read does not
  flag it again; both decisions are in the audit trail.

**Next:** none of ours.

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

### WID-H07: audit and erasure (P2, fixed)

**Done:** a SQL test of the audit trail's rules
(`tests/foundation/audit-trail-integrity.sql`), run against the live
database on 12 October and passing. It checks that:
- a row cannot be updated or deleted;
- the purge refuses a cut inside 365 days;
- a legal hold stops it;
- once released, it removes only the old row, records the purge, and the
  chain still verifies.

**Owner decisions (12 Oct):**
- **retention:** 1 year on Free and Pro, 3 years on Max, 7 years on
  Enterprise. **Done:** `PLAN_DEFAULTS` changed; migration 0143 (applied)
  raised the one existing subscription below its new default and makes the
  database refuse less than 365 days (checked live: an insert with 30 days
  is refused);
- **typed text:** kept out of audit records; the row keeps the record's id
  and a hash of the text;
- **erasure:** identifiers only, after the typed-text change.

**Done (owner decision, 12 Oct):** typed text out of audit records.
- `writeAudit` takes `typedText`; each value is stored only as
  `metadata.typedText.<field> = { fingerprint, length }`. The fingerprint is
  an HMAC-SHA256 keyed from `SECRET_ENCRYPTION_KEY` and the tenant
  (`lib/audit/typedText.ts`): anyone holding the text can prove it with
  `matchesFingerprint`, a retired key still verifies, and a short reason
  cannot be guessed from the trail. With no key configured the text is
  still never stored.
- The 20 sites a person's typing reached are converted. These cover
  member status, API-key and automation-credential revocation, policy
  descriptions, approval comments, fulfilment notes, onboarding notes,
  application lifecycle reasons, package justifications, details and
  revocations, discovery notes, agent lifecycle reasons, identity link
  basis, attestation statements, rogue-access decisions, and emergency
  controls. A contract update now audits version ids and numbers, not the
  contract text.
- Where the audit row was the only copy, the words now live on the
  record. Migration 0150 (applied) adds `applications.lifecycle_note` and
  `agent_identities.link_basis`, and a fulfilment claim note is kept in
  the task's `note`.
- Not covered: rows written before this change keep their text, under the
  legal-obligation exemption; audit rows can never be changed. The
  platform's own audit (vendor staff) is not covered either, and nor are
  object names (organization, group and role names). Names are for the
  identifiers-only step.

Tests: `lib/audit/typedText.test.ts` (3); assertions in
`accessFindings.test.ts` and `identities.test.ts`.

**Done (owner decision, 12 Oct):** identifiers only, on the audit side. A
survey of every `writeAudit` call found three places that wrote personal
data, and four that wrote an outside system's id which may be personal. All
now record ids, field names or fingerprints:
- **connector writes (`integration.write_*`)**: `targetFields` instead of
  the target, which held a new account's email and name or an existing
  account's login. The target stays on `connector_write_operations` (the
  event's `correlationId`);
- **account reconciliation (`account.reconciled`)**: kept accounts by
  `accountId`, not by their login;
- **platform admin granted**: the user's id, not their email;
- **fingerprinted (`typedText`)**:
  - an agent identity link's `externalReference`;
  - a source record's `externalId` on unlink and on a pending-match
    decision;
  - a webhook payload's `externalId`.

Not changed:
- object names that people type for applications, roles, groups,
  policies and connections. They are not personal data.
- error text returned by outside systems, kept for diagnosis. It may
  quote an account name; it is cut to 200 to 1,000 characters.

**Done (owner decision, 12 Oct):** identifiers only, on the erasure side
(`modules/privacy/subjectData.ts`, `eraseLinkedRecords`). Erasure and the
removed-member retention run now also:
- cover EXTERNAL identities (guests, partners, contractors), not only HUMAN;
- clear the identity's `source_native_id` and `correlation_key`;
- set the person's accounts' `account_name` to the pseudonym;
- delete the values sources sent about the person
  (`identity_source_changes`, `identity_source_conflicts`), so a
  source-match undo is no longer possible for them;
- replace the email, login and name in connector write targets that named
  the person (`pseudonymiseWriteTarget`). The outcome, the idempotency
  record and the system's account and entitlement references stay.

Kept, on purpose:
- an account's `external_account_ref` and a source link's `external_id`.
  The account or record still exists in its system, and its access must
  stay governed (non-negotiable #7: the system is the record holder).
- The erasure result reports `stillHeldAtSource` (source records still
  present, accounts still active). The organization erases those at the
  source; otherwise the next import brings the data back.

Tests: `modules/privacy/rules.test.ts` and `subjectData.test.ts` (17 passed, 5 new; the latter checks every statement carries the tenant filter, against a stub client); the JSON-path filters
the erasure uses were checked read-only against the live API.

**Still open (decision to come):** per-person encryption keys, if a
customer or regulator requires crypto-erasure.

### WID-H08: automation credential address allow-list (P1, fixed)

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

**Done (12 Oct): tested end to end at the deployed ingress.**
`automation-credentials.spec.ts` ("WID-H08") limits an approved credential
to 203.0.113.0/24 (TEST-NET-3), then calls the API with that address in six
headers: `x-forwarded-for`, `x-vercel-forwarded-for`, `x-real-ip`,
`forwarded`, `true-client-ip` and `x-client-ip`.
- **Local server** (no trusted edge): refused, 403 `ADDRESS_NOT_ALLOWED`.
  The address is unknown, so it fails closed.
- **Production, through Vercel's edge** (`E2E_INGRESS_URL`): refused, 403
  `ADDRESS_NOT_ALLOWED`.
- **Positive control:** with every address allowed, the same calls pass
  the address check. They reach the rate limit (429), which is checked
  after the address. So the edge supplied a real address, and the refusal
  above was the address, not a missing one.

Run by hand against `https://id.wonderapps.biz` on 12 October: 13 passed.
The nightly now sets `E2E_INGRESS_URL` to production
(`scripts/e2e-on-vercel.sh`), so the edge is re-checked every night.

**Done: each supported deployment documented.**
`docs/security/SECURITY-CONTROLS.md` §5 covers:
- Vercel;
- self-hosted behind an ingress (`CLIENT_IP_HEADER`, last hop; the
  ingress must be the only way in);
- anything else (unknown address, refused).

The demo-org kit (`demo-org/`) is a simulated customer's systems, not a
WonderID deployment, so it needs no setting.

Found on the way: production cannot decrypt a credential created by a
server with another `SECRET_ENCRYPTION_KEY`, and answers 500. This only
happens with a test credential created locally; it is not a path users
reach.

