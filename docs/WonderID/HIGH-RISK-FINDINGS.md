# WonderID — High-Risk Findings Register

> **Purpose:** Living register for Critical and High-risk gaps found by the hourly audit of [WonderID Knowledge Base](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md), with follow-up verification against the repository where feasible. It is **not** a list of confirmed exploitable vulnerabilities.
>
> **Initial review:** 2026-10-12 (Asia/Kolkata)  
> **Last check:** 2026-10-13 09:06 IST (hourly audit run by Claude Code, authorised by the owner 2026-10-13; main @ `376473b`)  
> **Source knowledge-base blob SHA:** `45a1723ac9eb7c080146981a0a79d2dd86b2d55c` (remediation tracker blob `1481459bfb90821f3e7b7a4da7fd540d547702fc`)  
> **Owner:** WonderID project team (triage/assignee TBD)  
> **Audit scope:** Source document reviewed in full. **Code and tests:** first post-merge review 2026-10-12 (CLAUDE.md §19.12); each finding's evidence names the files and tests checked. Runtime behavior and deployed controls not verified.
>
> **Status rules:** `OPEN` = gap or inconsistency remains documented, or a potentially important control has not been verified; `CHANGED` = evidence or wording changed but closure criteria not met; `FIXED` = closure criteria were validated with file/line or commit/test evidence; `REOPENED` = regression or contrary evidence; `ACCEPTED` = closed on the owner's explicit risk-acceptance decision, not on a fix (revisit if its trigger arrives). **Do not close on prose changes alone** when implementation behavior matters. Do not claim a missing safeguard is absent from code merely because it is not described in the guide.

## Current summary

| Severity | Open | Changed | Verified fixed | Accepted by owner |
|---|---:|---:|---:|---:|
| Critical (P0) | 0 | 0 | 2 | 1 |
| High (P1) | 0 | 1 | 7 | 0 |

**Fixed caveat (2026-10-13):** the FIXED closures of 09:06 IST rest on code inspection, committed unit/E2E/SQL tests and a verified local unit run (21 files, 338 passed). E2E results are as recorded by the remediation tracker (local runs), not re-executed here. The full nightly Playwright run has not been green since these merges (#97 failed, #98 failed, #99 cancelled; #100 hand-started, chosen specs, green). A red nightly on any of the cited specs reopens the finding.

Priority reflects the potential harm *if the ambiguity or missing control translates into real behavior*, not an established production incident.

## Critical (P0)

### WID-C01 — Approval-policy contradiction
- **Status:** ACCEPTED (owner risk acceptance 2026-10-12; safeguards verified 2026-10-13 09:06 IST)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§1](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#1-what-wonderid-is) says every access change is approved by a person; [§7](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#7-requesting-access) permits automatic low-risk approval; [§9](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#9-risk-and-findings) permits later approval of rogue access.
- **Risk:** Access could be granted with an authorization model inconsistent with organizational expectations; auditors cannot tell whether a change was pre-approved, policy-approved or retroactively regularized.
- **Required action:** Specify exactly which changes require human approval, what policy-authorized automatic decisions mean, who can publish/alter policies, what counts as retrospective acceptance, and how distinct decision types appear in immutable evidence. Enforce maker/checker for sensitive decisions.
- **Closure criteria:** Guide provides one consistent model; request/approval policy implementation and authorization tests confirm it, including self-approval and privilege-escalation edge cases.
- **Verification evidence:** Code checked 2026-10-12 (PR "connection upgrade; findings review"):
  - Catalog requests block self-approval in the planner, the service and the database (`approvalRules.ts:63-64`, `approvals.ts:356-358`, migration `0093`), with tests.
  - Auto-approval is recorded distinctly: audit `access.request_auto_approved`, `policy_result.checks.approval = "automatic"`, `decided_by` null (`requestCatalog.ts:332,349`).
  - A policy whose threshold is `critical` auto-approves **high**-risk requests; now pinned by a test (`requestRules.test.ts`, "WID-C01").
  - The older agent-request path (`requests.ts:111-113`) has no built-in requester ≠ approver check: a flag-only SoD policy lets the requester approve, by design (`tests/e2e/sod.spec.ts`).
  - Knowledge base §1, §7 and §17 corrected to say this.
  - **Owner decisions open:** a hard self-approval block on the agent path (it changes D5's tested flag behaviour); capping auto-approval below high risk; maker/checker on request-policy changes; a distinct record for rogue access approved afterwards (see WID-H04).
- **Follow-up (2026-10-12 12:40 IST):** The latest [knowledge base §1](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#1-what-wonderid-is) distinguishes automatic low/medium-risk decisions from human-only high-risk approvals. [Remediation evidence](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/FINDINGS-REMEDIATION.md#wid-c01-approval-policy-p2-partly-fixed) identifies self-approval and risk-threshold safeguards. **Still unresolved:** maker/checker for request-policy edits and retrospective approval provenance (WID-H04).

- **2026-10-13 audit (09:06 IST) — CHANGED → ACCEPTED.** Owner decisions of 12 Oct ([tracker](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/FINDINGS-REMEDIATION.md#owner-decisions)): nobody decides their own agent request (`SELF_APPROVAL`, `requests.ts`, `decideAccessRequest`; `tests/e2e/sod.spec.ts`); high and critical risk always need a person (`ALWAYS_HUMAN_RISK`, `requestRules.ts`; `requestRules.test.ts`); rogue access approved afterwards is recorded distinctly (WID-H04). The remaining gap, one administrator may loosen a request policy without a second approver (audited), was **explicitly accepted by the owner**. Revisit when an enterprise customer or SOX/SOC 2 auditor asks for maker/checker on configuration.

### WID-C02 — Urgent revocation and time-bound-access verification
- **Status:** FIXED (implementation and committed tests verified 2026-10-13 09:06 IST; see fixed caveat)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§3](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#3-identities) describes leavers without urgent access-revocation deadlines; [§7](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#7-requesting-access) says end-dated access “is removed and recorded as expired”; [§8](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#8-making-the-change-by-a-person-or-automatically) defaults fulfilment tasks to three days and verifies after a later read.
- **Risk:** Terminated users or expired privileged access may remain effective in a target system despite a status that suggests removal.
- **Required action:** Define termination/emergency revocation paths and SLAs, priority queues, disconnected application escalation, failed connector handling, and `requested/attempted/pending confirmation/verified revoked` state distinctions. Treat unverified expiry as unresolved.
- **Closure criteria:** Guide and implementation clearly distinguish policy expiry from effective target revocation; integration tests cover connector outages, delayed sync, failed deprovisioning and emergency termination.
- **Verification evidence:** Code checked 2026-10-12:
  - Expiry and verified removal are separate states. The ledger shows `EXPIRED` at the end date (`ledgerRules.ts:22-25`). The daily sweep (`accessExpiry.ts:32-81`) opens removal tasks (`pending_removal`), which become `removed_unverified` and then revoked only when a full reconciliation no longer finds the access (`connectorAccessRules.ts:240-246`).
  - Gaps confirmed:
    - removal can start up to a day late;
    - one SLA for every task kind;
    - no escalation for a removal marked done but never confirmed;
    - leaver `revoke_access` tasks have no assignee or deadline and open no per-grant removals (`humanLifecycle.ts:104-105`).
  - Knowledge base §3 and §7 corrected.
  - **Owner decisions open:** an urgent revocation path for leavers and emergencies (per-grant removals, priority SLA, escalation); a request status for "expired, removal pending" vs "removal verified".
- **Follow-up (2026-10-12 12:40 IST):** [Remediation tracker](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/FINDINGS-REMEDIATION.md#wid-c02-urgent-revocation-and-time-bound-access-p1-in-progress) and the updated knowledge base document per-grant leaver removal tasks, one-day removal/disable SLA, escalation and distinct `removal pending / removed unverified / verified` states. **Still unresolved:** connector outage, delayed-sync and failed-deprovisioning integration tests, plus the policy decision on automated leaver removals. Earlier gap details above are retained as historical baseline.

- **2026-10-13 audit (09:06 IST) — CHANGED → FIXED.** Evidence: disable-on-leave, the owner-approved automation path under #15 ([`leaverRemovals.ts`](https://github.com/luvchakra/wonder-agent/blob/main/modules/access-governance/leaverRemovals.ts#L107-L115), `accountsToDisableOnLeave` in `connectorFulfilmentRules.ts`, tests "WID-C02"); per-grant leaver removal tasks due within a day (`REMOVAL_SLA_DAYS`, `fulfilmentTaskRules.ts`); one-time escalation of overdue removals (migration `0135`); reminder for a removal marked done but never confirmed (`UNCONFIRMED_REMOVAL_DAYS`); request states "removal pending / removed, not yet verified / removal verified" (`pendingGrantRules.ts`). E2E `connector-provisioning.spec.ts` "WID-C02 leaver" covers system outage, failed deprovisioning (marked done but still present → `removed_unverified`, never revoked) and recovery; `leaver-removals.spec.ts` covers emergency termination. Unit tests run here: pass. **Residual (owner decisions, not defects):** each access removal stays a person's task; the expiry sweep is daily, so removal can start up to a day after an end date.

### WID-C03 — Gateway enforcement can be bypassed
- **Status:** FIXED (gateway promises match coverage; residual prevention gap accepted by owner; verified 2026-10-13 09:06 IST; see fixed caveat)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§4](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#4-ai-agents) says agents **can** send actions via Runtime Gateway and describes enforce mode and emergency suspension; it does not establish that all paths to target APIs must go through the gateway.
- **Risk:** Direct-to-target calls might bypass contract enforcement or emergency stop; users could overestimate what is blocked.
- **Required action:** Document mandatory routing conditions, scope of enforcement, treatment of direct credentials and alternate network paths, fail-open/fail-closed behavior, limitations of emergency suspension, and how bypasses are detected.
- **Closure criteria:** Gateway promises explicitly match actual coverage and bypass/stop tests; unsupported enforcement paths are prominently disclosed.
- **Verification evidence:** Code checked 2026-10-12:
  - The gateway is advisory: only calls sent to it are checked, and no bypass detection exists.
  - Observe mode (default) always tells the agent to proceed (`gateway.ts:147`), including when the decision is `EVALUATION_FAILED` or the kill switch is on. Enforce mode returns the real answer, and a lookup failure is DENY.
  - Enforce is switched on per organization by a platform administrator (feature flag).
  - Behaviour now pinned by tests (`gateway.test.ts`, "WID-C03"). Knowledge base §4 corrected.
  - **Owner decisions open:** whether the kill switch and lookup failures block even in Observe mode; flagging runtime events with no matching gateway decision; making the gateway the only path.

- **2026-10-13 audit (09:06 IST) — CHANGED → FIXED** against the closure criteria (promises match coverage, bypass/stop tests, unsupported paths disclosed). [Knowledge base §4](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#4-ai-agents) now states that only calls sent to the gateway are checked and that bypass detection is after the fact. Emergency controls and undecidable decisions block in every mode (`ALWAYS_BLOCKING_CODES`, [`gateway.ts`](https://github.com/luvchakra/wonder-agent/blob/main/modules/runtime-assurance/gateway.ts#L144)). Bypass detection (`gatewayBypass`, `modules/risk/signals.ts`; migration `0137`). Owner-chosen per-agent "gateway only" (migration `0144`): a bypass becomes critical (`applyGatewayOnlyOverride`, `scoring.ts`) and the agent is suspended at the gateway (`AGENT_SUSPENDED`, [`runtimeDecision.ts`](https://github.com/luvchakra/wonder-agent/blob/main/modules/access-governance/runtimeDecision.ts#L181)); tests `gateway.test.ts`, `emergency.test.ts`, `rules.test.ts`, E2E `runtime-gateway.spec.ts` "WID-C03 gateway only". **Residual, accepted by the owner:** a direct call is not prevented, only detected from reported events (last 200 per agent); credential brokering deferred.

## High (P1)
- **Follow-up (2026-10-12 12:40 IST):** [Remediation tracker](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/FINDINGS-REMEDIATION.md#wid-c03-gateway-coverage-p2-partly-fixed) cites gateway emergency block behavior in Observe mode and after-the-fact bypass detection from reported runtime events. **Still unresolved:** direct target-system calls without gateway interception, unreported actions and enforcing a mandatory gateway boundary. Not verified fixed.

### WID-H01 — Identity correlation and reassignment controls
- **Status:** FIXED (owner decisions implemented; verified 2026-10-13 09:06 IST; see fixed caveat)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§3](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#3-identities) matches by ID, employee number or verified email and sends ambiguous records to pending review.
- **Risk:** Recycled email addresses, reused employee numbers, multi-source conflicts or rehires could merge identities incorrectly and inherit access.
- **Required action:** Specify durable source-scoped IDs, immutable external identifiers, source priority, lifecycle and rehire handling, review/quarantine of ambiguous and conflicting matches, and merge reversal/audit.
- **Closure criteria:** Correlation rules documented and tested for reassignment, duplicates, rehires and conflicts.
- **Verification evidence:** Code checked 2026-10-12:
  - Source links (`source_id, external_id`) win first. Configured rules follow (email by default; username or a composite of fields). Several matches go to Pending Matches.
  - There is no employee number and no verified-email check.
  - **Fixed in this PR:** a single match on a terminated or archived identity now goes to Pending Matches instead of linking automatically (`identitySourceRules.ts`, `correlate`; test "WID-H01").
  - Knowledge base §3 corrected (matching; duplicate merge applies only to AI agents).
  - **Open:** accounts that are not linked by hand are re-correlated each run, so a reassigned email moves the account; there is no merge reversal and no source-priority policy.
- **Audit reassessment (2026-10-12 12:40 IST):** No new evidence satisfying the existing closure criteria was established during this retry; status carried forward. Consult remediation tracker for ongoing engineering progress.
- **2026-10-12 follow-up (13:45 IST):** The [remediation tracker](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/FINDINGS-REMEDIATION.md#wid-h01-identity-correlation-p2-partly-fixed) documents holding account identity relinks when a later source match changes, and routing terminated/archived-person matches for review. **Still outstanding:** merge reversal and agreed source priority. No implementation-level fix declared.

- **2026-10-13 audit (09:06 IST) — CHANGED → FIXED.** Reassignment: an account keeps its person when a later match changes (`relink_held`, migration `0139`; `accountRules.test.ts` "WID-H01"). Rehire/terminated: a single match on a terminated or archived identity goes to review. Conflicts: source priority kept and every disagreement listed (`identity_source_conflicts`, migrations `0146`/`0147`; `tests/integration/identity-sources-isolation.sql`). Reversal: unlink with undo for source records (history, restore, never re-matched by itself; migration `0148`) and accounts (migration `0149`); E2E `identity-sources.spec.ts` and `account-inventory.spec.ts`. **Residual (owner decision):** email-only matching continues; revisit if unlinks become frequent.

### WID-H02 — Provisioning idempotency and partial-failure recovery
- **Status:** FIXED (verified 2026-10-13 09:06 IST; see fixed caveat)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§8](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#8-making-the-change-by-a-person-or-automatically) states a unique attempt key means “a system never applies the same change twice,” with two retries and fallback to manual tasks.
- **Risk:** Unique keys alone cannot guarantee exactly-once behavior across arbitrary connectors; timeout/replay after partial success can duplicate actions or create inconsistent grants.
- **Required action:** Define idempotency support per target/operation, read-before-retry, durable operation state, partial account-create/grant recovery, compensation, backoff, replay-safe manual handoff and reconciliation.
- **Closure criteria:** Claim narrowed to demonstrably supported targets or fully evidenced by connector-specific safeguards and crash/timeout tests.
- **Verification evidence:** Code checked 2026-10-12:
  - Each attempt has its own key (`fulfil:<task>:<attempt>`). The key is claimed once in WonderID (`connectorWrites.ts:66-94`) and sent as `Idempotency-Key`, which only supporting systems honour.
  - 429 and 5xx are retried. A timeout is probably not retried automatically.
  - "Try again" sends a new attempt without reading the system first.
  - The knowledge base claim "a system never applies the same change twice" was wrong. §8 and §17 are corrected.
  - **Owner decisions open:** one key per task instead of per attempt; reading the system before a retry after an unclear failure; declaring which connection types support idempotency.
  - Since INTEGRATION-P0-22 slice 2 (LDAP changes): a directory answer that the change is already there (results 20, 16 and 68) counts as done (`framework/ldapWrite.ts`, `alreadyApplied`; tests in `ldapWrite.test.ts`), so an LDAP retry cannot apply a change twice. http connections are unchanged.
- **Audit reassessment (2026-10-12 12:40 IST):** No new evidence satisfying the existing closure criteria was established during this retry; status carried forward. Consult remediation tracker for ongoing engineering progress.

- **2026-10-13 audit (09:06 IST) — CHANGED → FIXED.** One `Idempotency-Key` per task and change (`systemKey`, `connectorWriteRules.ts`; migration `0141`); failure classification (not applied / unclear / refused); per-type `repeatable` declarations; an unclear non-repeatable change is never resent and "Try again" is refused until a complete read after the failure (`READ_PENDING`, migration `0142`). Crash/timeout tests in `connectorFulfilment.test.ts`; E2E `connector-provisioning.spec.ts` (WID-H02 cases). The narrowed knowledge-base claim matches. Partly created accounts are deliberately not compensated automatically (#15).

### WID-H03 — Incomplete sync and false deletion detection
- **Status:** FIXED (verified 2026-10-13 09:06 IST; see fixed caveat)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§5](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#5-connecting-your-systems) relies on incremental reads and at least one daily full read to detect removals, plus a 20% mass-missing threshold.
- **Risk:** Partial pages, expired cursors, corrupt feeds or outages may produce false missing records below 20%, while real removals could be delayed or skipped.
- **Required action:** Require completion proofs (page count/checksums where applicable), cursor reset and replay handling, source health checks, per-entity thresholds, transactionally safe sync activation and deletion quarantine for incomplete runs.
- **Closure criteria:** Sync completeness, failed pagination and deletion-guard tests are evidenced; docs explain when records can safely become “missing.”
- **Verification evidence:** Code checked 2026-10-12:
  - Records are marked missing only for a kind read completely in a full run with no failures (`stagingRules.ts:32-41`). Incremental and partial runs never mark missing.
  - The 20% hold applies to kinds with 20 or more records.
  - Gaps confirmed:
    - a cut-short incremental run still counts as succeeded and moves the cursor;
    - a cut-short full run resets the daily full-read clock.
  - Knowledge base §5 corrected.
  - This PR also makes the first sync after a connection upgrade a full read (`syncJobs.ts`, `lastGoodRuns`).
  - **Open:** treat a cut-short incremental run as partial (it changes run status and full-read frequency); per-kind thresholds; proof of completeness.
- **Audit reassessment (2026-10-12 12:40 IST):** No new evidence satisfying the existing closure criteria was established during this retry; status carried forward. Consult remediation tracker for ongoing engineering progress.
- **2026-10-12 follow-up (13:45 IST):** Verified [staging completeness/status rules](https://github.com/luvchakra/wonder-agent/blob/main/modules/integrations/stagingRules.ts#L29-L54) and [unit cases](https://github.com/luvchakra/wonder-agent/blob/main/modules/integrations/stagingRules.test.ts#L81-L103) for truncated partial runs and per-kind thresholds. The [remediation tracker](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/FINDINGS-REMEDIATION.md#wid-h03-incomplete-syncs-p2-partly-fixed) reports an applied all-missing guard for small populations. **Still outstanding:** E2E failed-middle-page test, with cursor/marking verification.

- **2026-10-13 audit (09:06 IST) — CHANGED → FIXED.** A run cut short at a limit is partial and never moves the cursor or resets the full-read clock (`runStatus`, `lastGoodRuns`); people held above 10% and any kind held when all records would vanish (migration `0140`; `tests/integrations/staging-missing.sql`); completeness proof from a system-reported total (`reportedTotal`, `framework/http.ts`; SCIM `totalResults`), a short read marks nothing missing. E2E `sync-failed-page.spec.ts` covers a failed middle page and an empty page under `X-Total-Count`. Cursors are WonderID timestamps, not expiring tokens. Checksums wait for a system that offers one.

### WID-H04 — False positives and provenance gaps for rogue access
- **Status:** FIXED (verified 2026-10-13 09:06 IST; see fixed caveat)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§6](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#6-applications-accounts-and-access) labels post-onboarding access without an approval `Rogue`; [§9](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#9-risk-and-findings) groups it into tickets and allows later approval.
- **Risk:** Missing historical data, emergency access and external approved processes can be mistaken for confirmed unauthorized access; after-the-fact approval may obscure original unauthorized activity.
- **Required action:** Define `unproven/suspected/confirmed unauthorized/accepted exception/remediated` criteria, investigation and evidence provenance, SLA and severity, and immutable record of retroactive approval.
- **Closure criteria:** Classification/exceptions/ticket state transitions are consistent across documentation and implementation tests.
- **Verification evidence:** Code checked 2026-10-12:
  - Ledger statuses are VALID / EXPIRED / REVOKED / UNPROVEN / ROGUE / LEGACY_EXCEPTION / PENDING_RECONCILIATION (`ledgerRules.ts:44`).
  - Rogue findings close automatically as `verified_fixed` whether the access was removed or approved later; the two are indistinguishable on the finding (`accessFindings.ts:169-178`). The append-only ledger keeps the earlier ROGUE status.
  - Manual accept / false-positive closure is limited to agent findings (`findings.ts:427,474`).
  - Knowledge base §6 (Unproven) and §9 (closing) corrected.
  - **Owner decisions open:** a separate "approved afterwards" resolution, or the request id on the finding; exception and false-positive closure for rogue findings on human accounts.
- **Audit reassessment (2026-10-12 12:40 IST):** No new evidence satisfying the existing closure criteria was established during this retry; status carried forward. Consult remediation tracker for ongoing engineering progress.
- **2026-10-12 follow-up (13:45 IST):** Verified [rogue finding resolution rules](https://github.com/luvchakra/wonder-agent/blob/main/modules/risk/accessFindingRules.ts#L15-L29), [unit cases](https://github.com/luvchakra/wonder-agent/blob/main/modules/risk/accessFindingRules.test.ts#L6-L16), and [finding synchronization](https://github.com/luvchakra/wonder-agent/blob/main/modules/risk/accessFindings.ts#L210-L236): removal and retrospective approval now have separate resolution outcomes, preserving link to the approving request where available. **Still outstanding:** accepted-exception and false-positive closure criteria for human accounts; no full closure.

- **2026-10-13 audit (09:06 IST) — CHANGED → FIXED.** Accepted exception (reason, at most 90 days, enforced in app and database by `risk_findings_rogue_exception_window`, migration `0145`; reopens when it ends) and false positive (reason; the grant is not flagged again) for rogue findings on any account; decided by someone other than the account's owner with `risk.manage` ([`accessFindings.ts`](https://github.com/luvchakra/wonder-agent/blob/main/modules/risk/accessFindings.ts#L304-L307)), audited, decision kept on the finding. Tests `accessFindingRules.test.ts`, E2E `connector-provisioning.spec.ts` "WID-H04". **Observation (not blocking):** the self-decision check compares identities only, so a decider with no linked identity passes it; separation is from the account owner, not from whoever granted the access.

### WID-H05 — Connector security and tenant boundary for user-defined endpoints
- **Status:** CHANGED (code verified, knowledge base corrected, partial fix shipped; closure criteria not yet met)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§5](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#5-connecting-your-systems) offers configurable HTTP, LDAP, SQL, MCP and file endpoints; the Connector Gateway allegedly blocks internal or unexpected addresses. [§17](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#17-safety-and-trust) asserts database-enforced tenant isolation.
- **Risk:** Endpoint configuration, redirects, DNS rebinding, secrets and connector processes can become SSRF, data-exfiltration or cross-tenant pathways if not consistently constrained.
- **Required action:** Specify allowable outbound destinations, DNS/redirect validation, private-IP rules and exceptions, credential scoping/rotation, sandboxing, least-privilege DB roles, tenant-context propagation and negative tests.
- **Closure criteria:** Threat-model and automated tenant/SSRF/security tests substantiate the gateway and isolation guarantees.
- **Verification evidence:** Code checked 2026-10-12:
  - Private, loopback, link-local, CGNAT, metadata and IPv6 internal ranges are blocked. Every resolved address is checked at connect time, and the checked address is used. Redirects (at most 3) are re-checked. The private-network exception is a platform setting, never per organization.
  - **Fixed in this PR:**
    - a connection's custom API-key header is now dropped on a redirect to another origin, like `Authorization`;
    - a 307/308 redirect to another origin that would resend the request body (which may hold an API key) is refused (`outboundFetch.ts`, `credentialHeaders`; tests "WID-H05").
  - Knowledge base §5 corrected.
  - **Open:** tests for an actual DNS rebind and for a strict-policy redirect to a private address; 6to4/Teredo ranges; sandboxing and egress allow-lists (owner).
- **Audit reassessment (2026-10-12 12:40 IST):** No new evidence satisfying the existing closure criteria was established during this retry; status carried forward. Consult remediation tracker for ongoing engineering progress.
- **2026-10-12 follow-up (13:45 IST):** Verified [outbound private-address handling](https://github.com/luvchakra/wonder-agent/blob/main/modules/integrations/outboundPolicy.ts#L100-L125), [address-range tests](https://github.com/luvchakra/wonder-agent/blob/main/modules/integrations/outboundPolicy.test.ts#L16-L39), and [redirect/rebinding tests](https://github.com/luvchakra/wonder-agent/blob/main/modules/integrations/outboundFetch.test.ts#L89-L140). The specific SSRF and redirect concerns have stronger code/test evidence. **Still outstanding:** independent tenant-isolation, connector sandbox/egress and holistic threat-model validation; remain CHANGED.

- **2026-10-13 audit (09:06 IST):** status carried forward (CHANGED). New since 13:45: IPv6-embedded private ranges (6to4, IPv4-compatible, Teredo, local NAT64, 6to4 relay) refused in `isPrivateAddress`, and DNS-rebinding tests in `outboundFetch.test.ts` (run here: pass). **Still outstanding:** connector sandboxing, per-organization egress allow-lists and a holistic threat model. The tracker lowered this to P3; independent severity stays High.

### WID-H06 — Automation credential privilege scoping
- **Status:** FIXED (repository implementation and committed test evidence verified 2026-10-12 12:40 IST; production not independently exercised)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§8](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#8-making-the-change-by-a-person-or-automatically) mentions credential ownership, second-admin approval, expiry, network restrictions and rate limits but not allowed scopes or permitted API actions.
- **Risk:** A compromised automation key may gain broader read/write or approval powers than its workflow needs.
- **Required action:** Define per-credential permission scopes, tenant/application boundaries, prohibited sensitive operations, approval separation, rotation, immediate revocation, misuse detection and complete audit trails.
- **Closure criteria:** Scope enforcement is documented and denied-access, revoke/rotate, and cross-tenant tests are verified.
- **Verification evidence:** Code checked 2026-10-12:
  - A credential's power is its backing member's roles, assigned tenant-wide. It never holds `automation.manage`, and never a permission its assigner lacks.
  - Four-eyes applies to creation and extension, in the app and the database.
  - Expiry is 1–365 days, enforced in the app only.
  - Revocation is immediate.
  - Allowed calls and address refusals (403) are audited; 401 and 429 refusals are not.
  - Nothing prevents a credential from holding `access.approve`, so a credential can approve access.
  - Knowledge base §8 corrected.
  - **Owner decisions open:** forbid automation credentials from approving access; four-eyes on role changes to an active credential; audit 401/429 refusals; a database cap on expiry.
- **Closure verification (2026-10-12 12:40 IST):** Reviewed current [`automationCredentialRules.ts`](https://github.com/luvchakra/wonder-agent/blob/main/lib/security/automationCredentialRules.ts#L164-L179), [its unit tests](https://github.com/luvchakra/wonder-agent/blob/main/lib/security/automationCredentialRules.test.ts#L118-L160), [automation-credentials E2E test cases](https://github.com/luvchakra/wonder-agent/blob/main/tests/e2e/automation-credentials.spec.ts#L165-L235), and [remediation evidence](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/FINDINGS-REMEDIATION.md#wid-h06-automation-credential-scope-p2-fixed). Human-only permissions are disallowed, role upgrades require different-approver reapproval, credential refusals are audited in a bounded way, and the E2E cases cover expiry, rotation/revocation and cross-tenant behavior. Earlier 'open' claims above are historical observations superseded by this evidence. **FIXED at committed implementation/test-evidence level; production runtime not independently tested in this audit.**

- **2026-10-13 audit (09:06 IST):** remains FIXED; `automationCredentialRules.test.ts` run here: pass. No contrary evidence.

### WID-H07 — Immutable audit vs. personal-data erasure and retention
- **Status:** FIXED (owner decisions implemented; verified 2026-10-13 09:06 IST; see fixed caveat)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 (code)
- **Evidence:** [§12](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#12-audit-reports-notifications-and-search) says audit entries cannot be deleted; [§13](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#13-privacy) says erasure never touches the audit trail, while retaining legal holds and privacy deadlines.
- **Risk:** Unbounded personal-data retention and unclear erasure exceptions may conflict with jurisdiction-specific obligations or organizational retention policies.
- **Required action:** Publish audit field minimization, retention schedule, data-subject request exceptions, lawful basis, pseudonymization/redaction design, legal-hold resolution, and destruction/crypto-erasure options consistent with integrity evidence.
- **Closure criteria:** Privacy/legal sign-off and tested retention/erasure handling support the guide's guarantees; immutable evidence is preserved appropriately.
- **Verification evidence:** Code checked 2026-10-12:
  - Updates are always rejected. Deletes happen only through `purge_audit_logs` (oldest first, never the last 365 days, stopped by a legal hold, the chain check resumes; migration `0104`) when an organization has turned on an audit retention policy.
  - Erasure pseudonymises identities, consent and the account, and writes no email to the audit trail.
  - Audit metadata can hold free-text reasons.
  - There is no test for `purge_audit_logs` or the append-only trigger.
  - Knowledge base §12 and §17 corrected.
  - **Open:** a SQL test for the append-only and purge rules; owner/legal: default retention, minimising free-text metadata, crypto-erasure.
- **Audit reassessment (2026-10-12 12:40 IST):** No new evidence satisfying the existing closure criteria was established during this retry; status carried forward. Consult remediation tracker for ongoing engineering progress.
- **2026-10-12 follow-up (13:45 IST):** Verified presence of [audit retention/integrity SQL tests](https://github.com/luvchakra/wonder-agent/blob/main/tests/foundation/audit-trail-integrity.sql#L1-L78), including checks for immutable rows, 365-day protection, legal holds and retained-chain validation; the [remediation tracker](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/FINDINGS-REMEDIATION.md#wid-h07-audit-and-erasure-p3-waiting-on-the-owner) reports a successful live run, not independently executed here. **Still outstanding:** retention defaults, free-text PII minimization and crypto-erasure/legal sign-off.

- **2026-10-13 audit (09:06 IST) — CHANGED → FIXED.** Retention defaults by plan with a 365-day database floor (migration `0143`); typed text out of audit records, kept only as a keyed fingerprint (`lib/audit/typedText.ts`, 20 call sites, migration `0150`; `typedText.test.ts`); identifiers only in audit records (connector write targets, reconciliation, platform admin grant); erasure reaches accounts, source values, conflicts and connector write targets, and covers external identities (`modules/privacy/subjectData.ts`, `eraseLinkedRecords`; `subjectData.test.ts`, `rules.test.ts`, run here: pass); append-only and purge rules tested in `tests/foundation/audit-trail-integrity.sql`. **Residual (owner decisions):** audit rows written before 13 Oct keep their text under the legal-obligation exemption; crypto-erasure deferred; formal legal review is not evidenced, the owner decided.

### WID-H08 — Automation credential network allowlist trusts forwarding headers
- **Status:** FIXED (edge spoofing tested end to end; verified 2026-10-13 09:06 IST; see fixed caveat)
- **First seen / last checked:** 2026-10-12 / 2026-10-12 10:45 IST
- **Evidence:** [`lib/security/automationCredentials.ts`](https://github.com/luvchakra/wonder-agent/blob/main/lib/security/automationCredentials.ts) in `automationAccessNow()` selects the first client-supplied `x-forwarded-for` entry, falling back to `x-real-ip`, to enforce `allowed_cidrs`. [`proxy.ts`](https://github.com/luvchakra/wonder-agent/blob/main/proxy.ts) copies request headers for automation credentials and overwrites only `x-wonderid-request` and `x-wonderid-request-id`. The deployed ingress's overwrite/trusted-proxy configuration has **not** been verified.
- **Risk:** If the public edge forwards untrusted client-provided address headers without sanitizing them, an attacker holding a compromised automation credential could spoof an allowed source address and bypass its network allowlist. This is **conditional**; do not report as a confirmed exploitable vulnerability without validating ingress behavior.
- **Required action:** Resolve the client IP through a trusted edge/platform mechanism rather than a caller-controlled header, or require the edge to overwrite the headers and restrict direct origin access. Define trusted proxy hops. Add tests for spoofed and multi-hop forwarding headers, direct-to-origin access and the deployed ingress configuration. Fail closed if the source address cannot be trusted.
- **Closure criteria:** An end-to-end test at the actual ingress shows client-supplied forwarding headers cannot influence the validated IP; source address canonicalization and deny behavior are tested for each supported deployment configuration; changes are documented.
- **Verification evidence:** Code paths inspected 2026-10-12; deployment and end-to-end spoofing checks outstanding.
- **Follow-up (2026-10-12 12:40 IST):** [`trustedClientIp`](https://github.com/luvchakra/wonder-agent/blob/main/lib/security/automationCredentialRules.ts#L79-L96) now selects configured trusted ingress headers, Vercel-controlled headers or unknown/fail-closed, and [unit tests](https://github.com/luvchakra/wonder-agent/blob/main/lib/security/automationCredentialRules.test.ts#L125-L143) exercise selection/denial. **Still unresolved:** end-to-end production ingress spoofing test and verification of self-hosted proxy configuration. Treat potential exploitability as unconfirmed.

- **2026-10-13 audit (09:06 IST) — CHANGED → FIXED.** `automation-credentials.spec.ts` "WID-H08" sends a disallowed address in six forwarding headers: refused (403 `ADDRESS_NOT_ALLOWED`) locally (fail closed) and through the production Vercel edge, with a positive control proving the edge supplied a real address (13 passed by hand on 12 Oct, per the tracker). The nightly sets `E2E_INGRESS_URL` to production ([`scripts/e2e-on-vercel.sh`](https://github.com/luvchakra/wonder-agent/blob/main/scripts/e2e-on-vercel.sh#L100)), so the edge is re-checked nightly. Deployments documented in `docs/security/SECURITY-CONTROLS.md` §5. A self-hosted ingress that does not overwrite `CLIENT_IP_HEADER` remains the customer's configuration responsibility, documented.

## Hourly review protocol

1. Fetch the latest `docs/WonderID/KNOWLEDGE-BASE.md`, this register and relevant implementation/tests/commit changes from `main`.
2. Re-evaluate **every** open or changed finding, not just new document edits. Identify additional Critical/High issues, use stable IDs and avoid duplicates.
3. Record findings as `OPEN`, `CHANGED`, `FIXED` or `REOPENED`, with exact evidence links, code/test verification if available, and a short explanation. **Do not equate disappearance of wording with a fixed control**.
4. On every hourly run, update the last-checked timestamp (IST), source commit/blob SHA, summary counts and an hourly check-history row. Keep prior issue descriptions and fix evidence; never erase history.
5. Commit the updated file to `docs/WonderID/HIGH-RISK-FINDINGS.md` on `main` (ChatGPT, or the Claude Code hourly audit routine; CLAUDE.md §19.12), only after re-fetching its blob SHA to avoid overwriting changes. A run that changes no status, finding or evidence still sends its report but need not commit (each commit to `main` uses one of the day's 100 deployments, CLAUDE.md §19.9). If write or verification fails, report that explicitly rather than claiming an update.
6. Send an hourly user-facing report: new findings, fixed/reopened/changed items, still-open P0/P1 counts, repository link and any blocked validation.

## Check history

| Checked (IST) | Knowledge-base SHA | Outcome | Register action |
|---|---|---|---|
| 2026-10-12 (baseline) | `4fc40ff98ed36a619d1073414b182a7ab4e2a36f` | Established 3 P0 and 7 P1 candidates from full document; implementation unverified | Register created |
| 2026-10-12 10:45 IST (manual) | `8218bec727a2f89a5b632154db888dfaa4bed2d7` | Rechecked 3 P0 and 7 previously tracked P1; none verified fixed. Added WID-H08 after reviewing forwarding-header handling in automation credential middleware; ingress security not verified. | 1 P1 OPEN added; 3 P0 and 7 P1 remain CHANGED |
| 2026-10-12 11:34 IST | `3c370bad21093fe4900560ed939fffbd182edc18` | Verified current document and repository write access; carried forward existing risk statuses without asserting a fix. No full code/security re-audit in this diagnostic. | Diagnostic history entry committed; 3 P0 CHANGED, 7 P1 CHANGED, 1 P1 OPEN |
| 2026-10-12 12:40 IST (manual retry) | `5734cded248edddf2594b7773b3627da203ddc80` | Reassessed all 11 P0/P1 findings and current remediation; WID-H06 verified FIXED at implementation/test-evidence level. WID-H08 improved but deployment not verified. Remaining: 3 P0 + 7 P1. | 0 new, 1 fixed, 1 status advanced OPEN→CHANGED, 0 reopened; update committed on main |
| 2026-10-12 13:45 IST (manual continuation) | `286f7d58165ce00c577b281e2de48124d896ba9d` | Rechecked 11 findings against the latest knowledge base, remediation tracker and selected implementation/tests. Evidence improved for H01, H03, H04, H05 and H07; no closure criteria satisfied. | 0 NEW, 0 status CHANGED, 0 FIXED, 0 REOPENED; unresolved 3 P0 + 7 P1; H06 remains FIXED |
| 2026-10-13 09:06 IST (Claude Code hourly audit) | `45a1723ac9eb7c080146981a0a79d2dd86b2d55c` | Reassessed all 11 against main @ `376473b` (14 merges, #119–#132), the tracker and the code; 21 unit-test files run (338 passed). Owner decisions applied. Full nightly not green since the merges. | 0 NEW; 8 FIXED (C02, C03, H01, H02, H03, H04, H07, H08); C01 ACCEPTED by owner; H05 CHANGED; H06 remains FIXED; 0 REOPENED |
