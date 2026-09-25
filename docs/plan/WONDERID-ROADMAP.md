# WonderID Roadmap — P0 stories by module and phase

**Adopted 2026-09-26 by explicit user decision** (see `CLAUDE.md` header and
non-negotiable #7). Source specification:
`docs/requirements/WonderID_P0_Implementation_Spec_v3.md` (repository-grounded v3)
with its mockups `docs/requirements/wonderid-*.png`.

## How to read this

- WonderID extends this repository; it does not replace it. Every story below is
  owned by an existing module and extends that module's own tables, services and
  routes (spec rules R1–R5). No parallel app, database, RBAC, policy engine or
  agent registry.
- Story IDs continue each module's own numbering and appear as rows in that
  module's Progress Tracker (`docs/plan/NN-*-BACKLOG.md`), so `npm run progress`
  counts them. Each backlog has a dated "WonderID (2026-09-26)" section with the
  story definitions.
- Order follows the spec's phases (§45 / v3 "Implementation phases"), with one
  change agreed with the user: the WonderID brand and navigation shell come first,
  so every later phase lands in the final information architecture.
- Everything WonderAgent already does stays P0 and must keep working (spec R3,
  invariant 10). QA gates every phase with the full Playwright suite.

## Decisions taken while planning (recorded, not asked)

Per the spec's autonomy rule (§44) these were resolved with the recommended
option and can be revisited:

1. **Identity model (spec R5).** One tenant-scoped `identities` table is the
   common identity *reference*. A human identity may link to a Foundation `users`
   row (someone who can sign in) or exist without one (an HR worker before first
   login). An AI agent's identity row links 1:1 to its `agents` row, which stays
   canonical for every agent field; the identity row carries only the shared
   governance fields. Non-agent machine identities (service accounts,
   applications, workloads, APIs) are first-class rows.
2. **Three kinds of role stay separate** (spec H9): Foundation `roles` are
   WonderID permission roles; new Access `business_roles` are application/business
   roles granted to identities; application roles remain entitlements.
3. **Workflow engine** lives in Operations (it already owns jobs and
   notifications) and calls Access policy evaluation rather than evaluating
   policy itself.
4. **Passwordless** is built as a WebAuthn/passkey layer on the existing Supabase
   Auth session (spec: "do not create a parallel authentication/session stack").
5. **Brownfield access classification** defaults to UNPROVEN, not ROGUE, for
   access present before a tenant's WonderID go-live date; ROGUE applies to access
   that appears after it without authorization (spec H4).

## Stories

| Phase | Story | Title | Module |
|---|---|---|---|
| 0 | QA-P0-20 | WonderID baseline lock, contract amendment and roadmap | QA |
| 0 | EXPERIENCE-P0-18 | WonderID brand and dark navy navigation shell | Experience |
| 1 | IDENTITY-P0-15 | Unified identity reference model (human, external, machine, service account, application, workload, API, AI agent) | Identity |
| 1 | IDENTITY-P0-16 | Identity attributes and relationships (custom attribute definitions; manager, owner, sponsor, delegate edges) | Identity |
| 1 | IDENTITY-P0-17 | Identities directory and identity detail (overview, type views, search, detail tabs) | Identity |
| 2 | INTEGRATION-P0-08 | Authoritative identity sources (registry, authoritative-for, precedence, mappings, correlation rules, CSV/SCIM/REST templates) | Integration |
| 2 | INTEGRATION-P0-09 | Identity import and reconciliation pipeline (validate, normalize, correlate, stage, apply; runs; pending correlations) | Integration |
| 2 | IDENTITY-P0-18 | Human lifecycle: joiner, mover, leaver, rehire, ownership transfer | Identity |
| 3 | ACCESS-P0-15 | Application catalog model and inventory (type, owners, environment, risk, onboarding status) | Access |
| 3 | INTEGRATION-P0-10 | Application discovery and unrecognized applications | Integration |
| 3 | INTEGRATION-P0-11 | Connector capability model, write interface with idempotency, SSRF guard | Integration |
| 3 | ACCESS-P0-16 | Application onboarding: state machine, checklist, validate, simulate, approve, promote | Access |
| 3 | INTEGRATION-P0-12 | AI-assisted onboarding proposals from OpenAPI/sample payloads (proposal only) | Integration |
| 3 | ACCESS-P0-17 | Account inventory: correlation to identities, orphan and dormant accounts | Access |
| 4 | ACCESS-P0-18 | Self-service request catalog and request policies (self, others, duration, justification) | Access |
| 4 | ACCESS-P0-19 | Approval engine: multi-stage chains, approver scope, no self-approval | Access |
| 4 | ACCESS-P0-20 | Access packages (resources, policy, assignment, expiry) for humans and agents | Access |
| 4 | ACCESS-P0-21 | Business and IT roles: entitlements, hierarchy, assignment, simulation | Access |
| 4 | ACCESS-P0-22 | Preventive SoD on entitlement combinations (block, exception, extra approval, warn) | Access |
| 4 | INTEGRATION-P0-13 | Provisioning and deprovisioning pipeline (plan, pre-checks, execute, verify) | Integration |
| 4 | ACCESS-P0-23 | Delegations: approval, request, administration, access-on-behalf | Access |
| 5 | ACCESS-P0-24 | Access ledger and provenance ("why does this identity have this access?") | Access |
| 5 | ACCESS-P0-25 | Imported access classification (authorized, legacy, unproven, rogue) and drift findings | Access |
| 5 | RISK-P0-13 | Rogue Access management: inventory, investigation, remediation, severity, trend | Risk |
| 6 | COMPLIANCE-P0-10 | Certification campaigns for every identity type, reviewer types and decisions | Compliance |
| 7 | FOUNDATION-P0-19 | WonderID permissioning: object, request, approval and admin scope; default roles | Foundation |
| 7 | FOUNDATION-P0-20 | Permission simulation and the Permissions (WonderID) screens | Foundation |
| 8 | PLATFORM-P0-13 | Configuration Studio: versioned tenant configuration, publish and rollback | Platform |
| 8 | OPERATIONS-P0-09 | Workflow designer and runs (declarative, idempotent nodes) | Operations |
| 9 | IDENTITY-P0-19 | AI agent onboarding journey, sponsor, agent access packages, lifecycle policies | Identity |
| 10 | FOUNDATION-P0-21 | Passwordless: passkeys/WebAuthn enrollment, sign-in, policy, step-up, recovery | Foundation |
| 11 | EXPERIENCE-P0-19 | WonderID Home and My Access self-service portal | Experience |
| 11 | OPERATIONS-P0-10 | WonderID insights, reports and identity graph views | Operations |
| 11 | EXPERIENCE-P0-20 | WonderID AI assistant (governed: explain, search, draft, simulate) | Experience |
| 12 | QA-P0-21 | WonderID security hardening pass (spec 37A test matrix) | QA |
| 12 | QA-P0-22 | Brownfield migration fixture (HR to certification, end to end) | QA |

Already scheduled and still open: EXPERIENCE-P0-16 (remaining mockup screens,
now folded into the WonderID screens) and QA-P0-18 (gateway security suite).
