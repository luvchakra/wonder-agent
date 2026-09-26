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

---

## Phase 4b — Tenant & user permissioning (added 2026-09-26)

**Source:** two further user-supplied specifications, stored with their mockups:

- `docs/requirements/WonderID_Tenant_User_Permissioning_Model.md` — the tenant
  and user permissioning model (TENANT-001…004, IAM-001…010);
- `docs/requirements/WonderID_User_Role_Permission_Management_Requirements.md`
  — the detailed user, role and permission management requirements (P0
  acceptance §54, implementation sequence §58);
- `docs/requirements/wonderid-tenants-roles-mockups.png` (platform tenants,
  tenant creation, tenant login, tenant administration, users, roles, role
  designer, permission catalog);
- `docs/requirements/wonderid-users-roles-mockups.png` (users, add-user wizard,
  role details, custom role wizard, scope and conditions, user detail and
  effective permissions).

It runs **next**, ahead of Phase 4's remaining stories. Every later tenant
administration and self-service screen depends on it, and both specifications
say it must be implemented once and consumed by every module.

**Gap analysis (2026-09-26, read-only survey of the repository).** These
already exist and are extended, not replaced:

- `tenants` (uuid, unique slug, status) and `tenant_memberships`
  (active, invited, suspended, removed); `current_tenant_ids()` requires an
  active membership in an active tenant (0039).
- `roles` / `permissions` / `role_permissions` / `user_roles`: 11 system
  roles and 44 permission keys; `requirePermission()` over a per-request
  permission list.
- The `/settings/roles` screen; audit of role changes; platform suspend,
  activate and decommission; SSO connections; per-user TOTP; hard-coded
  session timeouts.

These are missing and are what this phase builds: hostname resolution and
`tenant_domains`; a tenant security profile; member invite, suspend and
remove; custom roles; groups; scope; conditions; deny rules; decisions and
explanations; audit of refusals; certification of WonderID users; and the
Users, Groups, Roles and Permissions screens.

| Phase | Story | Title | Module | Spec |
|---|---|---|---|---|
| 4b | FOUNDATION-P0-22 | Tenant identity, tenant URL and domain registry: slug policy, `tenant_domains`, hostname resolution, suspended-tenant sign-in, tenant-branded sign-in page, tenant context in the shell | Foundation | TENANT-001/002/003 |
| 4b | PLATFORM-P0-14 | Platform tenant list with tenant URLs and the create-tenant wizard (organization, domain & URL, security & identity, subscription, review, success) | Platform | mockups 1–3 |
| 4b | FOUNDATION-P0-23 | Users and membership lifecycle: invite/create (wizard), activate, suspend, deactivate, remove, session revocation, last-administrator and self-escalation protection; Users list and User detail (roles & groups, effective permissions, access history, sessions) | Foundation | IAM-001; §5–8, 23–24, 30–34 |
| 4b | FOUNDATION-P0-24 | Permission catalog: resource, action, module (Discover/Understand/Govern/Protect/Assure/Administration), sensitivity and labels on the existing stable keys; administrative permissions; catalog screen | Foundation | IAM-002; §13–14, 28 |
| 4b | FOUNDATION-P0-25 | System and custom roles: the spec's system roles, protected definitions, role lifecycle, custom role designer (basic details, permissions by module, scope & conditions, review; copy an existing role), role details | Foundation | IAM-003; §15–22, 53 |
| 4b | FOUNDATION-P0-26 | Groups: groups, members, group role assignments; effective permissions include group roles | Foundation | IAM-004; §11–12 |
| 4b | FOUNDATION-P0-19 | (re-scoped) Scoped assignments and the authorization engine: assignment scope (tenant, environment, application, agent, resource), source, start/expiry, conditions, explicit deny rules; `authorize()` → ALLOW / DENY / REQUIRE_APPROVAL with reason codes; `requirePermission()` built on it | Foundation | IAM-005/006; §18–20, 26, 40–41 |
| 4b | FOUNDATION-P0-20 | (re-scoped) Authorization explanation and effective permissions with provenance ("why can / why can't"), access audit including refusals | Foundation | IAM-007/008; §25, 36, 49–50 |
| 4b | FOUNDATION-P0-27 | Tenant security profile: SSO/password/MFA requirements, session and idle timeouts, AI-agent security defaults, audit retention — enforced, not only stored | Foundation | TENANT-004; spec §26 |
| 4b | COMPLIANCE-P0-11 | Access certification of WonderID users' role assignments (certify / revoke), as audit evidence | Compliance | IAM-009; §35 |
| 4b | EXPERIENCE-P0-21 | Administration navigation (Access Control: Users, Groups, Roles, Permissions; Authentication; Security; Audit) and persistent tenant context | Experience | IAM-010; §29, 46–47 |

### Decisions taken while planning (recorded, not asked)

1. **Permission IDs stay stable.** The existing 44 keys (e.g. `agent.read`,
   `access.approve`) are the stable permission IDs. Both specifications
   require stable IDs (§10), and the ownership map forbids renaming keys. The
   spec's `<resource>.<action>` vocabulary is carried as catalog metadata:
   resource, action, module and label. New keys are added only for
   capabilities with no existing key (users.*, groups.*, roles.*,
   permissions.view, access_reviews.*, tenant.security.manage and so on).
   Nothing is renamed.
2. **System role keys stay.** `TENANT_SUPER_ADMIN` is shown as "Tenant
   Administrator" and `IAM_ADMIN` as "Identity Administrator". The spec's
   missing system roles are added (Agent Administrator, Runtime Security
   Administrator, Governance Administrator, Security Analyst). The other
   existing system roles (IAM Architect, Certification Manager, the owner
   roles, Requester) stay.
3. **Tenant URL.** Each tenant is at `https://<slug>.<BASE_APP_HOST>`
   (a new `BASE_APP_HOST` setting; the specs' "Base App URL" placeholder).
   - The hostname narrows the tenant among the signed-in user's active
     memberships. It never grants access (non-negotiable #2; spec §2).
   - The bare host keeps today's membership and switcher behaviour.
   - Production needs a wildcard domain on the Vercel project, a deployment
     step for the user. Until then subdomains are exercised on
     `*.localhost` in tests.
4. **Environment scope** uses the environment already on applications
   (ACCESS-P0-15) and agents. Resource scope uses the object's id. Further
   scope types are added as rows, not schema changes (§19).
5. **Open question for the user (recorded, not blocking).** Both new mockup
   sets show a light sidebar, and §45 asks for a light theme. On
   2026-09-26 the user explicitly chose the dark navy sidebar
   (EXPERIENCE-P0-18). The navy sidebar stays until the user says
   otherwise; content areas are already light.

## Phase 4c — WonderID branding (added 2026-09-26)

**Source:** a further user-supplied specification, stored with its brand sheet:

- `docs/requirements/WonderID_Branding_Application_Wide_Implementation_Requirements.md`
  (stories BRAND-001…012, §78; implementation order §79);
- `docs/requirements/wonderid-brand-sheet.png` (mark, lockups, colour
  variations, app icon, favicon, clear space, minimum size, palette, login).

It runs alongside Phase 4b. The foundation (assets, configuration, tokens,
logo components, shell and sign-in) changes the shared shell, so it lands
before the Phase 4b administration screens, which are then built already
branded.

| Phase | Story | Title | Module | Spec |
|---|---|---|---|---|
| 4c | EXPERIENCE-P0-22 | Brand foundation: `public/brand/` artwork (mark, lockups, monochrome, favicons, app icons, social image), one brand configuration (`modules/ui/brand.ts`), brand tokens mapped onto the semantic tokens, `<WonderIDLogo />` and a separate `<TenantLogo />` | Experience | BRAND-001/002/003/006 |
| 4c | EXPERIENCE-P0-23 | Brand in the shell and authentication: sidebar lockup, collapsed W mark, mobile header mark, sign-in (tagline lockup, organization identity), tab-title convention, favicon | Experience | BRAND-004/005 |
| 4c | EXPERIENCE-P0-24 | Brand across core components, product modules and administration: chart palette, per-page tab titles, W-mark empty, loading, error and 404 states, permission chips and security warnings | Experience | BRAND-007/008/009 |
| 4c | EXPERIENCE-P0-25 | Visual regression baselines for the key screens (sign-in first; dashboard, Agent 360, runtime, administration and mobile navigation once P0-24 lands) | Experience (with QA) | BRAND-012 |
| 4c | Operations P1 | Branded system e-mail with tenant-aware links; branded reports and evidence packages (logo, tenant, metadata, page numbers, footer) | Operations | BRAND-010/011 (P1) |

### Decisions taken while planning (recorded, not asked)

1. **The artwork is the user's own brand sheet** (user instruction,
   2026-09-26: "just use the attached images"). `scripts/brand/extract-assets.py`
   cuts each asset out of `docs/requirements/wonderid-brand-sheet.png`:
   the lockups with and without the tagline, light and dark; the marks;
   monochrome; the icons; the social image. It redraws nothing: it only
   removes each panel's flat background, blanks the tagline where a plain
   lockup is needed, and resamples the fixed icon sizes. The files are
   PNG at the sheet's resolution (the full lockup is 748 px wide). The
   specification prefers SVG (§9), so official vector files, when
   supplied, replace them. A first pass that redrew the mark was dropped.
2. **Colour values follow the specification's text.** The sheet image
   prints Deep Navy #081220 and Electric Blue #2563FF; the text (§19, §67)
   says #08122C and #2538FF. The text is used.
3. **Semantic tokens stay the interface.** `--primary` becomes Electric
   Blue (6.8:1 on white) and the sidebar Deep Navy; components keep using
   `primary`, `sidebar` and so on. `--brand-*` constants exist for brand
   surfaces only. Status colours are unchanged, and `--violet` stays the
   text-safe AI tone: brand Violet #8B5CF6 is 4.2:1 on white, below AA
   for small text.
4. **The navy sidebar stays.** The specification describes a light
   console, and its sidebar sketch has no colour. The user's explicit
   2026-09-26 decision for a dark navy sidebar stands, and content surfaces
   are light (see Phase 4b, decision 5).
5. **The tagline.** "IDENTITIES • AGENTS • ACCESS • SECURITY" appears on
   the brand-introducing surfaces only (sign-in, onboarding, social
   image), never under the in-app logo (§5). The CLAUDE.md line "Govern
   every identity. Verify every access." remains the contract's summary.
   The landing page's tab title now uses the specification's secondary message.
6. **One brand configuration.** The platform console's "Product name"
   setting (`/platform-admin/branding`, Platform-owned) predates this. It
   overlaps §71 ("no second brand configuration"). It is handed to
   PLATFORM-P0-14 to fold into, or retire in favour of, `wonderIdBrand`,
   not changed here.

