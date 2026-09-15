# Governance Requirements Reconciliation — 2026-09-15

**Source document:** user-supplied `WonderAgent Updated P0/P1 Governance
Requirements` (`4bec72d1-...md`), status "Proposed scope lock," 2026-09-15.
**Task:** the user asked to reconcile this document against the existing
11-module backlog before any code is written — see `AskUserQuestion`
response "Reconcile into backlogs first." **No application code, migrations,
or tests were touched in this pass** — this is a documentation/planning
pass only, per CLAUDE.md §4's workflow and the precedent set by every prior
"Requirements Refresh" entry across the module backlogs.

**Method:** the full source document was read end to end, then cross-checked
against every module's current `## Progress Tracker`, `## P1`, `## P2`, and
latest dated `## Requirements Refresh` section (all 11 `docs/plan/NN-*-
BACKLOG.md` files), plus `docs/design/ownership-map.md`'s existing "Pending
ownership/architecture decisions" list, so this pass builds on — and does
not re-derive from scratch — the two prior 2026-09-14 refresh rounds already
recorded in each module's own file.

---

## 1. Headline finding

The overwhelming majority of this document's P0 list (§3-§26, "P0-01"
through "P0-24") is **already built or already tracked**, at equal or finer
granularity, across the 11 module backlogs — much of it as recently as
today's own Agent Discovery extension (P0-01). This document does surface a
small number of **genuinely new, concrete, in-module gaps** (added to the
relevant module's tracker below) and a larger number of **genuinely new
cross-cutting concepts that do not yet have an owning module** — those are
listed in §3 as open decisions for the user, not guessed at or silently
assigned to whichever agent happens to run next.

---

## 2. Section-by-section mapping

| Doc section | Disposition |
|---|---|
| P0-01 Agent Discovery & Shadow Agent Governance | **Already covered**, and further than this doc asks for — `buildDiscoveryInbox()` (IDENTITY-P0-05) plus today's Fully Functional Agent Discovery extension (detection/confidence/evidence, candidate review, ignore/link, registration wired to the existing lifecycle service). No new row. |
| P0-02 First-Class AI Agent Identity | **Already covered** — `agents` (IDENTITY-P0-01.1), `agent_owners` (IDENTITY-P0-02.2), `agent_relationships` (IDENTITY-P0-02.3), lifecycle/audit history. No new row. |
| P0-03 Agent Purpose & Identity Contract | **Partially covered, with a real content gap.** `agent_contracts` (IDENTITY-P0-03.1, Done) already carries purpose, approved/prohibited applications/data/actions, certification frequency, maximum risk. This doc names several fields the schema does not yet carry explicitly: **autonomy level**, a distinct **allowed-tools** list (separate from applications), **human approval requirements** as a structured field, **required monitoring**, and **required compliance controls** linkage. The 2026-09-14 refresh already flagged the tools/environment/expiry gaps as "content gaps to fold into a future revision, not a new story" — this pass agrees, except for **autonomy level**, which is new and load-bearing (see P0-10 below) rather than a minor field. Not added as a tracker row here because it depends on the P0-10 ownership decision first (§3). |
| P0-04 Agent Lifecycle Governance | **Partially covered.** The `DISCOVERED → REGISTERED` and `REGISTERED → APPROVED` gates (`lifecycle.ts`'s `validateTransition()`) already check purpose/source/owners and an active contract. This doc's "minimum production gate" additionally names risk assessment, required access review, human oversight policy, runtime monitoring, certification schedule, and required controls/evidence — none of which gate the `APPROVED → PROVISIONED → ACTIVE` transitions today. This is the same underlying gap as P0-11 (below) — see §3, not duplicated as a second open question. |
| P0-05 Ownership & Accountability | **Already covered**, with one small, unambiguous gap: `AgentOwnerType` (`business_owner \| technical_owner \| iam_owner \| application_owner \| data_owner`) has no `escalation_owner` value this doc asks for. Minor, Identity-owned, additive — flagged in Identity's own refresh entry below but not urgent enough to block on. |
| P0-06 Effective Access / CAN | **Already covered** — Access Agent's effective-access graph (ACCESS-P0-01.2/P0-03). No new row. |
| P0-07 SHOULD vs CAN | **Already covered** — ACCESS-P0-04 Contract Comparison, Done, unit-tested against the live FinanceBot fixture. The Autonomy/Human-approval comparison rows in this doc's table are blocked on the same P0-03/P0-10 contract-schema gap, not a new Access Agent gap. |
| P0-08 Runtime Assurance / DID | **Already covered** — Runtime Agent's own 2026-09-14 round-2 refresh concluded "nothing new" against near-identical wording (semantic event model, minimum captured fields). Not re-litigated here; trusted rather than re-derived, since Runtime Agent already did a live codebase cross-check. |
| P0-09 Action Governance | **Partially covered, real gap.** `agent_contracts` already has binary approved/prohibited action lists, and Risk Agent already detects `prohibited_action` violations. This doc's 4-state model per action (**Allowed / Allowed-with-human-approval / Restricted / Prohibited**) does not exist anywhere — today's model is binary. Same root cause as P0-10 (autonomy/approval model) — folded into that open question in §3, not a separate row. |
| P0-10 Human Oversight (autonomy levels 0-4) | **Genuinely new, no owner.** No module has an autonomy-level or human-oversight-tier concept today. This is the root dependency for P0-03's autonomy field, P0-07's autonomy/approval comparison row, and P0-09's 4-state action model. **Open decision — see §3.1.** |
| P0-11 Governance Policy | Same underlying gap as P0-04 — a "is this agent production-ready" policy over the contract/lifecycle fields themselves, distinct from Access Agent's existing access-time ABAC policy engine (ACCESS-P0-02.1/02.2, which is Done and out of scope here). **Open decision — see §3.2.** |
| P0-12 Governance Posture | **Genuinely new, no owner.** Explicitly distinct from Risk's risk score per this doc's own §12 heading ("separate from security risk"). No module computes a composite governed/partially-governed/non-compliant/exception-approved/suspended posture today. **Open decision — see §3.3.** |
| P0-13 Governance Attestation | **Priority conflict, not a gap.** Identity Agent's own P1 list already has this exact concept (`IDENTITY-P1-02` — "Attestation... owners attest purpose/owner/runtime/identity mapping remain accurate"), explicitly tiered P1 in two prior refresh rounds. This document reclassifies it P0 and broadens its fields (approver, decision, evidence references — closer to Compliance's `certification_decisions` shape than Identity's narrower self-attestation). **Open decision — see §3.4.** |
| P0-14 Governance Exceptions | **Overlap, not a gap.** Access Agent already owns `policy_exceptions` (P0 schema, `ACCESS-P1-04` for the full workflow). Compliance Agent separately lists its own P1-tier "Exception Governance" (`CERT-P1-04`) for control-mapping exceptions. This document's generic "Governance Exceptions" would be a *third* exception concept unless one of the existing two is broadened to be the canonical one. **Open decision — see §3.5.** |
| P0-15 Governance Drift | **Genuinely new, no owner.** No module computes "drift" as a first-class signal combining purpose/owner/access/autonomy/runtime changes into one event today, though several pieces exist in isolation (owner-change audit, policy version history, today's Agent Discovery `STALE` change signal). **Open decision — see §3.6.** |
| P0-16 Risk & Rogue Agent Detection | **Already covered** — Risk Agent's existing detection categories match nearly one-for-one. Two new category names ("expired approval," "governance control gap") only become meaningful once P0-12/13/14 exist — not actionable before then, no new row. |
| P0-17 Certification | **Already covered.** The baseline (scheduled campaign; review of access/scope/usage/risk/policy/posture/runtime evidence; 5 decision types) matches Compliance's existing P0 stories. Event-driven triggers (access expansion, owner change, drift, high-risk finding) are already correctly tiered P1 (`CERT-P1-01`, "Continuous Certification") — this document doesn't actually re-tier them to P0 on close reading, just lists them as examples of what a *scheduled* campaign should consider. No new row. |
| P0-18 Compliance Control Mapping | **Already covered** — COMPLIANCE-P0-02.1/02.2. No new row. |
| P0-19 Governance Evidence Pack | **Escalates an already-open question**, doesn't create a new one. `docs/design/ownership-map.md` already flags the Compliance-vs-Operations evidence-export ownership question as unresolved (COMPLIANCE-P0-06's "tamper-evident evidence export"). This document's evidence-pack scope is a superset of both (agent identity/owners/purpose/lifecycle/SHOULD/CAN/DID/risk/certification/**attestation**/**exception**/control-mapping/runtime/remediation/audit, in PDF/CSV/JSON) — strengthening the case that whichever module wins that decision needs a genuinely cross-module read path, not just Compliance's own tables. Folded into §3.7, referencing the pre-existing flag rather than duplicating it. |
| P0-20 Emergency Suspension / Kill Switch | **Mostly covered, one concrete gap found by direct code inspection.** `agents.lifecycle_state = SUSPENDED` already exists with role-gated transitions, a mandatory reason, and full audit (`lifecycle.ts`). Reading `NORMAL_TRANSITIONS` directly: `SUSPENDED: ["RETIRED"]` is the *only* transition out of `SUSPENDED` — there is no path back to an active state. This document's explicit "support controlled restoration" requirement is therefore unmet today. **Concrete, unambiguous, Identity-owned — added as a new tracker row, see §4.** "Notify stakeholders" on suspension is a separate, already-known gap (Operations' `notify()` is published but no module calls it yet, per Operations' own tracker) — not duplicated as a new item. |
| P0-21 Auditability | **Already covered** — `writeAudit()` used throughout every module. No new row. |
| P0-22 AI-Assisted Investigation | **Genuinely new, no owner, and not started anywhere.** No module's Progress Tracker mentions any LLM-backed feature — every module has been built strictly deterministic per non-negotiable #9. This is real, unbuilt P0 scope with a real product/security decision behind it (which LLM provider, what data crosses the boundary, where the advisory-only/never-authoritative line is drawn in code, not just in a comment). **Open decision — see §3.8.** |
| P0-23 Existing Integration Architecture | **Already covered** — reused throughout. `INTEGRATION-P0-05.1` (verified credential rotation) remains the one already-flagged, already-`Not started` gap from the prior refresh; not duplicated here. |
| P0-24 Customer Governance UX | **Already tracked as open, not new.** Experience Agent's own tracker already has `EXPERIENCE-P0-10` through `-13` as `Not Started` (Tenant Onboarding, Access Graph Visualization, Agent Detail header, Rogue Agent Detail actions). This document's expanded Governance Dashboard metrics and Agent Detail tab list (Governance, Certifications, Policies, Compliance, Findings alongside the existing four) are real, but building them is blocked on the P0-12/13/14/15 concepts existing first — noted in Experience's own refresh entry as a forward pointer, not a new row today. |

P1 items (§27) were spot-checked for genuine duplication/conflict rather than
mapped exhaustively (P0 is the priority; CLAUDE.md §3 already forbids
building P1 ahead of P0 module work). No conflicts found beyond what's
already noted above (P0-10/13/14's P1-tier echoes). §28's P2/Never-MVP list
matches the existing Product Boundaries (CLAUDE.md §10) and every module's
own P2 sections with no discrepancy.

---

## 3. Open decisions for the user

None of the following were guessed at or assigned to a module unilaterally —
each is a genuine architecture/ownership call CLAUDE.md §4 and the
per-module "Adding something not listed here" rule (`ownership-map.md` §5)
reserve to the user.

### 3.1 Human Oversight / Autonomy Model (P0-10)
Who owns the autonomy-level (0-4) concept and its enforcement hook? Most
natural fit is **Identity Agent** (it's a contract/SHOULD field, alongside
purpose/approved-actions), with **Access Agent's** policy engine consuming
it for the P0-09 4-state action model. Needs the user's confirmation before
either module scopes a story around it — it's foundational to three other
open items below.

### 3.2 Governance Readiness Policy (P0-04 / P0-11)
Is the "minimum production gate" (risk assessment done, access review
complete, human oversight policy, runtime monitoring configured,
certification schedule set) a new **Identity Agent** lifecycle precondition
(extending `validateTransition()`'s existing pattern), a new **Access
Agent** policy type (reusing `policies`/`policy_rules`), or a distinct new
concept? It reads across data three different modules own (contract,
access, certification), which is exactly the kind of thing CLAUDE.md's
module-boundary rules require a decision on rather than one agent claiming.

### 3.3 Governance Posture (P0-12)
No existing module owns a composite governance-posture score, and the doc
is explicit that it is *not* the same thing as Risk Agent's risk score.
Candidates: a new capability inside **Compliance Agent** (closest existing
concept — it already aggregates evidence/status across modules for
certification), a new thin capability owned by **Identity Agent** (it
already owns the lifecycle state that's one input), or a genuinely new
11th-module-adjacent concept. This is the single largest scope item in the
whole document and needs an explicit answer before any tracker row is
added anywhere.

### 3.4 Governance Attestation (P0-13)
Two questions bundled: **(a)** priority — stays `IDENTITY-P1-02` (P1, as
twice-reconciled) or promotes to P0 as this new doc asks? **(b)** ownership
— Identity Agent's existing narrow self-attestation concept, or does the
broader approver/decision/evidence-reference shape belong with **Compliance
Agent**, adjacent to `certification_decisions`? Do not build either
version until both are answered.

### 3.5 Governance Exceptions consolidation (P0-14)
Three candidate homes exist for "an approved exception to a governance
requirement": Access Agent's `policy_exceptions` (P0 schema already built),
Compliance Agent's planned `CERT-P1-04` control-mapping exceptions, and this
document's generic governance exception. Recommend the user pick **one**
canonical exception model (most likely Access's `policy_exceptions`,
broadened) rather than three modules each owning a slightly different
"exception" — but that broadening is itself a decision only the user can
make, since it changes Access Agent's already-`Done` schema's scope.

### 3.6 Governance Drift (P0-15)
Candidates: **Risk Agent** (it's the deterministic-detection specialist —
this would be a new finding category built from cross-module diffs) or
**Identity Agent** (it already owns lifecycle/ownership change history and
today's Agent Discovery `STALE` signal is a close cousin). Needs an owner
before it's scoped as a story anywhere.

### 3.7 Governance Evidence Pack (P0-19) — escalating the existing flag
Already flagged, unresolved, in `docs/design/ownership-map.md`: does
Compliance Agent build the evidence-package assembly (calling into
Operations Agent's export primitive), or does Operations own the export
mechanism entirely with Compliance only supplying data? This document's
broader per-agent evidence-pack scope (now explicitly including
attestation/exception data that doesn't exist yet per §3.4/§3.5) makes this
more urgent, not new — same question, higher stakes.

### 3.8 AI-Assisted Investigation (P0-22)
Nothing in the codebase touches an LLM API today. Needs: which
provider/model, what tenant data may leave the tenant boundary (or does
this run without ever sending customer data externally — e.g., summarizing
already-computed findings only), where the "advisory only, never
authoritative" boundary (non-negotiable #9's LLM restriction) is enforced
in code, and which module owns it — most likely **Experience Agent** for
the UI surface plus a new shared `lib/ai/` primitive other modules could
call read-only, but that is exactly the kind of "shared foundation
location" `ownership-map.md` §5 says requires the user's decision rather
than a module inventing it.

---

## 4. Concrete tracker updates made in this pass

Only items that are (a) unambiguous, (b) within one module's existing
charter, and (c) don't depend on any open decision in §3 were added as real
tracker rows:

- **`IDENTITY-P0-06` — Suspension Restoration Path** (new, Not Started):
  `lifecycle.ts`'s `NORMAL_TRANSITIONS` table allows `SUSPENDED → RETIRED`
  only; there is no transition back to an active state, so P0-20's
  "support controlled restoration" requirement cannot be met today. See
  `docs/plan/02-IDENTITY-AGENT-BACKLOG.md`'s own dated refresh entry.
- **`AgentOwnerType` gap** (escalation owner) — noted in Identity's own
  refresh entry as a minor additive schema gap, not given its own story
  number (bundle into whichever story picks up `IDENTITY-P0-06` or the
  next ownership-related pass).

Every other module's backlog received a short dated "Requirements Refresh
— 2026-09-15" entry confirming its portion of this document is already
covered and pointing back to this file for the cross-cutting open items —
see each `docs/plan/NN-*-BACKLOG.md`.

---

## 5. Process note (not re-litigated per-module this time)

Every prior refresh round flagged the same conflict between this
requirements-package lineage's "Modular Execution Guide" (agents must be
explicitly activated, never auto-chain) and this repository's standing
autopilot policy (`CLAUDE.md` §7, `docs/ORCHESTRATION.md` §2). This
document doesn't restate that guide, so it isn't re-flagged eleven more
times here — see any prior module refresh entry (e.g. Identity's or
Access's 2026-09-14 section) for the original note. Still unresolved, still
the user's call.
