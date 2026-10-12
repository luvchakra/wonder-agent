# WonderID — High-Risk Findings Register

> **Purpose:** Living register for Critical and High-risk gaps found by the hourly audit of [WonderID Knowledge Base](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md), with follow-up verification against the repository where feasible. It is **not** a list of confirmed exploitable vulnerabilities.
>
> **Initial review:** 2026-10-12 (Asia/Kolkata)  
> **Last hourly check:** 2026-10-12 (initial baseline; next scheduled check 10:14 IST)  
> **Source knowledge-base blob SHA:** `4fc40ff98ed36a619d1073414b182a7ab4e2a36f`  
> **Owner:** WonderID project team (triage/assignee TBD)  
> **Audit scope:** Source document reviewed in full; code implementation, tests, runtime behavior and deployed controls **not yet verified**.
>
> **Status rules:** `OPEN` = gap or inconsistency remains documented, or a potentially important control has not been verified; `CHANGED` = evidence or wording changed but closure criteria not met; `FIXED` = closure criteria were validated with file/line or commit/test evidence; `REOPENED` = regression or contrary evidence. **Do not close on prose changes alone** when implementation behavior matters. Do not claim a missing safeguard is absent from code merely because it is not described in the guide.

## Current summary

| Severity | Open | Changed | Verified fixed |
|---|---:|---:|---:|
| Critical (P0) | 3 | 0 | 0 |
| High (P1) | 7 | 0 | 0 |

Priority reflects the potential harm *if the ambiguity or missing control translates into real behavior*, not an established production incident.

## Critical (P0)

### WID-C01 — Approval-policy contradiction
- **Status:** OPEN (documentation contradiction; code verification required)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§1](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#1-what-wonderid-is) says every access change is approved by a person; [§7](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#7-requesting-access) permits automatic low-risk approval; [§9](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#9-risk-and-findings) permits later approval of rogue access.
- **Risk:** Access could be granted with an authorization model inconsistent with organizational expectations; auditors cannot tell whether a change was pre-approved, policy-approved or retroactively regularized.
- **Required action:** Specify exactly which changes require human approval, what policy-authorized automatic decisions mean, who can publish/alter policies, what counts as retrospective acceptance, and how distinct decision types appear in immutable evidence. Enforce maker/checker for sensitive decisions.
- **Closure criteria:** Guide provides one consistent model; request/approval policy implementation and authorization tests confirm it, including self-approval and privilege-escalation edge cases.
- **Verification evidence:** None yet.

### WID-C02 — Urgent revocation and time-bound-access verification
- **Status:** OPEN (control specification gap; code verification required)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§3](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#3-identities) describes leavers without urgent access-revocation deadlines; [§7](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#7-requesting-access) says end-dated access “is removed and recorded as expired”; [§8](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#8-making-the-change-by-a-person-or-automatically) defaults fulfilment tasks to three days and verifies after a later read.
- **Risk:** Terminated users or expired privileged access may remain effective in a target system despite a status that suggests removal.
- **Required action:** Define termination/emergency revocation paths and SLAs, priority queues, disconnected application escalation, failed connector handling, and `requested/attempted/pending confirmation/verified revoked` state distinctions. Treat unverified expiry as unresolved.
- **Closure criteria:** Guide and implementation clearly distinguish policy expiry from effective target revocation; integration tests cover connector outages, delayed sync, failed deprovisioning and emergency termination.
- **Verification evidence:** None yet.

### WID-C03 — Gateway enforcement can be bypassed
- **Status:** OPEN (enforcement-boundary ambiguity; code verification required)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§4](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#4-ai-agents) says agents **can** send actions via Runtime Gateway and describes enforce mode and emergency suspension; it does not establish that all paths to target APIs must go through the gateway.
- **Risk:** Direct-to-target calls might bypass contract enforcement or emergency stop; users could overestimate what is blocked.
- **Required action:** Document mandatory routing conditions, scope of enforcement, treatment of direct credentials and alternate network paths, fail-open/fail-closed behavior, limitations of emergency suspension, and how bypasses are detected.
- **Closure criteria:** Gateway promises explicitly match actual coverage and bypass/stop tests; unsupported enforcement paths are prominently disclosed.
- **Verification evidence:** None yet.

## High (P1)

### WID-H01 — Identity correlation and reassignment controls
- **Status:** OPEN (documentation/control gap; code verification required)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§3](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#3-identities) matches by ID, employee number or verified email and sends ambiguous records to pending review.
- **Risk:** Recycled email addresses, reused employee numbers, multi-source conflicts or rehires could merge identities incorrectly and inherit access.
- **Required action:** Specify durable source-scoped IDs, immutable external identifiers, source priority, lifecycle and rehire handling, review/quarantine of ambiguous and conflicting matches, and merge reversal/audit.
- **Closure criteria:** Correlation rules documented and tested for reassignment, duplicates, rehires and conflicts.
- **Verification evidence:** None yet.

### WID-H02 — Provisioning idempotency and partial-failure recovery
- **Status:** OPEN (unverified technical guarantee)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§8](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#8-making-the-change-by-a-person-or-automatically) states a unique attempt key means “a system never applies the same change twice,” with two retries and fallback to manual tasks.
- **Risk:** Unique keys alone cannot guarantee exactly-once behavior across arbitrary connectors; timeout/replay after partial success can duplicate actions or create inconsistent grants.
- **Required action:** Define idempotency support per target/operation, read-before-retry, durable operation state, partial account-create/grant recovery, compensation, backoff, replay-safe manual handoff and reconciliation.
- **Closure criteria:** Claim narrowed to demonstrably supported targets or fully evidenced by connector-specific safeguards and crash/timeout tests.
- **Verification evidence:** None yet.

### WID-H03 — Incomplete sync and false deletion detection
- **Status:** OPEN (documentation/control gap; code verification required)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§5](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#5-connecting-your-systems) relies on incremental reads and at least one daily full read to detect removals, plus a 20% mass-missing threshold.
- **Risk:** Partial pages, expired cursors, corrupt feeds or outages may produce false missing records below 20%, while real removals could be delayed or skipped.
- **Required action:** Require completion proofs (page count/checksums where applicable), cursor reset and replay handling, source health checks, per-entity thresholds, transactionally safe sync activation and deletion quarantine for incomplete runs.
- **Closure criteria:** Sync completeness, failed pagination and deletion-guard tests are evidenced; docs explain when records can safely become “missing.”
- **Verification evidence:** None yet.

### WID-H04 — False positives and provenance gaps for rogue access
- **Status:** OPEN (classification gap; code verification required)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§6](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#6-applications-accounts-and-access) labels post-onboarding access without an approval `Rogue`; [§9](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#9-risk-and-findings) groups it into tickets and allows later approval.
- **Risk:** Missing historical data, emergency access and external approved processes can be mistaken for confirmed unauthorized access; after-the-fact approval may obscure original unauthorized activity.
- **Required action:** Define `unproven/suspected/confirmed unauthorized/accepted exception/remediated` criteria, investigation and evidence provenance, SLA and severity, and immutable record of retroactive approval.
- **Closure criteria:** Classification/exceptions/ticket state transitions are consistent across documentation and implementation tests.
- **Verification evidence:** None yet.

### WID-H05 — Connector security and tenant boundary for user-defined endpoints
- **Status:** OPEN (high-impact control detail missing; code verification required)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§5](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#5-connecting-your-systems) offers configurable HTTP, LDAP, SQL, MCP and file endpoints; the Connector Gateway allegedly blocks internal or unexpected addresses. [§17](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#17-safety-and-trust) asserts database-enforced tenant isolation.
- **Risk:** Endpoint configuration, redirects, DNS rebinding, secrets and connector processes can become SSRF, data-exfiltration or cross-tenant pathways if not consistently constrained.
- **Required action:** Specify allowable outbound destinations, DNS/redirect validation, private-IP rules and exceptions, credential scoping/rotation, sandboxing, least-privilege DB roles, tenant-context propagation and negative tests.
- **Closure criteria:** Threat-model and automated tenant/SSRF/security tests substantiate the gateway and isolation guarantees.
- **Verification evidence:** None yet.

### WID-H06 — Automation credential privilege scoping
- **Status:** OPEN (authorization detail missing; code verification required)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§8](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#8-making-the-change-by-a-person-or-automatically) mentions credential ownership, second-admin approval, expiry, network restrictions and rate limits but not allowed scopes or permitted API actions.
- **Risk:** A compromised automation key may gain broader read/write or approval powers than its workflow needs.
- **Required action:** Define per-credential permission scopes, tenant/application boundaries, prohibited sensitive operations, approval separation, rotation, immediate revocation, misuse detection and complete audit trails.
- **Closure criteria:** Scope enforcement is documented and denied-access, revoke/rotate, and cross-tenant tests are verified.
- **Verification evidence:** None yet.

### WID-H07 — Immutable audit vs. personal-data erasure and retention
- **Status:** OPEN (privacy/control-policy ambiguity; code verification required)
- **First seen / last checked:** 2026-10-12 / 2026-10-12
- **Evidence:** [§12](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#12-audit-reports-notifications-and-search) says audit entries cannot be deleted; [§13](https://github.com/luvchakra/wonder-agent/blob/main/docs/WonderID/KNOWLEDGE-BASE.md#13-privacy) says erasure never touches the audit trail, while retaining legal holds and privacy deadlines.
- **Risk:** Unbounded personal-data retention and unclear erasure exceptions may conflict with jurisdiction-specific obligations or organizational retention policies.
- **Required action:** Publish audit field minimization, retention schedule, data-subject request exceptions, lawful basis, pseudonymization/redaction design, legal-hold resolution, and destruction/crypto-erasure options consistent with integrity evidence.
- **Closure criteria:** Privacy/legal sign-off and tested retention/erasure handling support the guide's guarantees; immutable evidence is preserved appropriately.
- **Verification evidence:** None yet.

## Hourly review protocol

1. Fetch the latest `docs/WonderID/KNOWLEDGE-BASE.md`, this register and relevant implementation/tests/commit changes from `main`.
2. Re-evaluate **every** open or changed finding, not just new document edits. Identify additional Critical/High issues, use stable IDs and avoid duplicates.
3. Record findings as `OPEN`, `CHANGED`, `FIXED` or `REOPENED`, with exact evidence links, code/test verification if available, and a short explanation. **Do not equate disappearance of wording with a fixed control**.
4. On every hourly run, update the last-checked timestamp (IST), source commit/blob SHA, summary counts and an hourly check-history row. Keep prior issue descriptions and fix evidence; never erase history.
5. Commit the updated file to `docs/WonderID/HIGH-RISK-FINDINGS.md` on `main`, only after re-fetching its blob SHA to avoid overwriting changes. If write or verification fails, report that explicitly rather than claiming an update.
6. Send an hourly user-facing report: new findings, fixed/reopened/changed items, still-open P0/P1 counts, repository link and any blocked validation.

## Check history

| Checked (IST) | Knowledge-base SHA | Outcome | Register action |
|---|---|---|---|
| 2026-10-12 (baseline) | `4fc40ff98ed36a619d1073414b182a7ab4e2a36f` | Established 3 P0 and 7 P1 candidates from full document; implementation unverified | Register created |

